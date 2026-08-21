from aws_cdk import (
    Stack,
    Tags,
    RemovalPolicy,
    Duration,
    CfnOutput,
    Fn,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_ecr as ecr,
    aws_ecs_patterns as ecs_patterns,
    aws_rds as rds,
    aws_iam as iam,
    aws_s3 as s3,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_secretsmanager as secretsmanager,
    aws_certificatemanager as acm,
    aws_logs as logs,
    aws_events as events,
    aws_events_targets as events_targets,
)
from constructs import Construct

# AMI fija (Amazon Linux 2023, arm64) en vez de "latest": con "latest",
# cualquier `cdk deploy` (incluido el automático de cada merge a staging)
# puede resolver una AMI distinta de la que ya está corriendo y forzar el
# reemplazo de la instancia — perdiendo el estado de Docker y causando un
# downtime no relacionado con el cambio que se estaba desplegando (mismo
# patrón que causó un incidente en Ticketlab el 2026-08-21, PR #17). Bump
# manual e intencional cuando haga falta.
_STAGING_PINNED_AMI_ID = "ami-04fc404d256fd34a2"


class TysStack(Stack):
    def __init__(
        self,
        scope: Construct,
        id: str,
        *,
        env_name: str,
        domain_name: str | None = None,
        certificate_arn: str | None = None,
        **kwargs,
    ):
        super().__init__(scope, id, **kwargs)

        # Stack-wide tag — needed to attribute AWS cost by project (cost
        # allocation tags, see the CostAndUsage.md doc in the ajcodelabs
        # codelabs-infra repo). Same pattern as TicketlabStagingStack.
        Tags.of(self).add("Project", "TicketYourself")
        Tags.of(self).add("Environment", env_name)

        if env_name == "staging":
            self._build_staging()
        else:
            self._build_production(domain_name, certificate_arn)

    # ═══════════════════════════════════════════════════════════════════
    #  STAGING
    # ═══════════════════════════════════════════════════════════════════

    def _build_staging(self):
        vpc = ec2.Vpc(self, "Vpc", max_azs=1, nat_gateways=0)
        # Staging exposes the backend/frontend ports directly on the EC2
        # instance (no ALB/TLS in front) to keep single-instance cost/setup
        # minimal; this is intentional for a non-production environment.
        sg = ec2.SecurityGroup(self, "Sg", vpc=vpc, allow_all_outbound=True)
        sg.add_ingress_rule(ec2.Peer.any_ipv4(), ec2.Port.tcp(80), "HTTP")
        sg.add_ingress_rule(ec2.Peer.any_ipv4(), ec2.Port.tcp(443), "HTTPS")
        sg.add_ingress_rule(ec2.Peer.any_ipv4(), ec2.Port.tcp(3000), "Frontend")
        sg.add_ingress_rule(ec2.Peer.any_ipv4(), ec2.Port.tcp(8000), "Backend")

        role = iam.Role(
            self,
            "InstanceRole",
            assumed_by=iam.ServicePrincipal("ec2.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name("AmazonSSMManagedInstanceCore"),
            ],
        )

        # GoDaddy API credentials for certbot's DNS-01 challenge (wildcard TLS
        # cert). Created empty — fill in after first deploy with:
        #   aws secretsmanager put-secret-value --secret-id <arn> \
        #     --secret-string '{"key":"...","secret":"..."}'
        godaddy_secret = secretsmanager.Secret(
            self,
            "GodaddyApiSecret",
            description="GoDaddy API key/secret for certbot DNS-01 (tys-staging wildcard TLS)",
        )
        godaddy_secret.grant_read(role)

        with open("user-data.sh") as f:
            user_data = ec2.UserData.custom(
                f.read().replace("__GODADDY_SECRET_ARN__", godaddy_secret.secret_arn)
            )

        instance = ec2.Instance(
            self,
            "Instance",
            instance_type=ec2.InstanceType("t4g.small"),
            machine_image=ec2.MachineImage.generic_linux({self.region: _STAGING_PINNED_AMI_ID}),
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PUBLIC),
            security_group=sg,
            associate_public_ip_address=True,
            user_data=user_data,
            role=role,
            block_devices=[
                ec2.BlockDevice(
                    device_name="/dev/xvda",
                    volume=ec2.BlockDeviceVolume.ebs(20, encrypted=True),
                )
            ],
        )

        eip = ec2.CfnEIP(self, "Eip", domain="vpc")
        ec2.CfnEIPAssociation(
            self, "EipAssoc", allocation_id=eip.attr_allocation_id, instance_id=instance.instance_id
        )

        CfnOutput(self, "Url", value=f"http://{eip.attr_public_ip}")
        CfnOutput(self, "Ssm", value=f"aws ssm start-session --target {instance.instance_id}")

        # ── Auto on/off schedule (cost saving) ───────────────────────────
        # 08:00-21:00 America/Guayaquil (UTC-5, no DST — fixed offset), daily.
        instance_arn = self.format_arn(service="ec2", resource="instance", resource_name=instance.instance_id)

        def schedule_ec2_action(rule_id: str, hour: str, api_action: str, iam_action: str, description: str) -> None:
            rule = events.Rule(
                self,
                rule_id,
                schedule=events.Schedule.cron(minute="0", hour=hour),
                description=description,
            )
            rule.add_target(
                events_targets.AwsApi(
                    service="EC2",
                    action=api_action,
                    parameters={"InstanceIds": [instance.instance_id]},
                    policy_statement=iam.PolicyStatement(
                        actions=[f"ec2:{iam_action}"],
                        resources=[instance_arn],
                    ),
                )
            )

        schedule_ec2_action(
            "StartInstanceSchedule", "13", "startInstances", "StartInstances",
            "Start TYS staging EC2 daily at 08:00 America/Guayaquil",
        )
        schedule_ec2_action(
            "StopInstanceSchedule", "2", "stopInstances", "StopInstances",
            "Stop TYS staging EC2 daily at 21:00 America/Guayaquil",
        )

        # ── GitHub Actions deploy role (OIDC, no static keys) ────────────
        # Only TysStaging creates the account-wide OIDC provider — IAM allows
        # exactly one provider per URL per account. If TysProduction ever
        # needs its own deploy role, import this provider by ARN instead of
        # creating a second one.
        github_oidc_provider = iam.OpenIdConnectProvider(
            self,
            "GithubOidcProvider",
            url="https://token.actions.githubusercontent.com",
            client_ids=["sts.amazonaws.com"],
        )

        github_deploy_role = iam.Role(
            self,
            "GithubDeployRole",
            role_name="tys-staging-github-deploy",
            max_session_duration=Duration.hours(1),
            assumed_by=iam.FederatedPrincipal(
                github_oidc_provider.open_id_connect_provider_arn,
                conditions={
                    "StringEquals": {
                        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                    },
                    # Restricted to pushes on the `staging` branch specifically —
                    # not "any workflow in this repo".
                    "StringLike": {
                        "token.actions.githubusercontent.com:sub": "repo:ajcodelabs-ai/Ticketyourself:ref:refs/heads/staging",
                    },
                },
                assume_role_action="sts:AssumeRoleWithWebIdentity",
            ),
        )
        github_deploy_role.add_to_policy(
            iam.PolicyStatement(
                actions=["ssm:SendCommand", "ec2:StartInstances"],
                resources=[
                    instance_arn,
                    f"arn:aws:ssm:{self.region}::document/AWS-RunShellScript",
                ],
            )
        )
        github_deploy_role.add_to_policy(
            iam.PolicyStatement(
                # None of these Describe*/GetCommandInvocation actions support
                # resource-level permissions in IAM (AWS requires "*" here);
                # SendCommand/StartInstances above are what's actually scoped.
                actions=[
                    "ssm:GetCommandInvocation",
                    "ssm:DescribeInstanceInformation",
                    "ec2:DescribeInstances",
                ],
                resources=["*"],
            )
        )

        CfnOutput(self, "GithubDeployRoleArn", value=github_deploy_role.role_arn)

    # ═══════════════════════════════════════════════════════════════════
    #  PRODUCTION
    # ═══════════════════════════════════════════════════════════════════

    def _build_production(self, domain_name: str | None, cert_arn: str | None):
        vpc = ec2.Vpc(
            self,
            "Vpc",
            max_azs=2,
            nat_gateways=1,
            subnet_configuration=[
                ec2.SubnetConfiguration(
                    name="Public", subnet_type=ec2.SubnetType.PUBLIC, cidr_mask=24
                ),
                ec2.SubnetConfiguration(
                    name="Private",
                    subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidr_mask=24,
                ),
            ],
        )

        # ── ECR ────────────────────────────────────────────────────────
        repo = ecr.Repository(
            self,
            "Repo",
            repository_name="tys-prod-backend",
            removal_policy=RemovalPolicy.RETAIN,
            image_scan_on_push=True,
        )
        repo.add_lifecycle_rule(max_image_count=20)

        # ── Secrets ────────────────────────────────────────────────────
        jwt_secret = secretsmanager.Secret(
            self,
            "JwtSecret",
            secret_name="tys-prod-jwt-secret",
            generate_secret_string=secretsmanager.SecretStringGenerator(
                exclude_punctuation=True, password_length=64
            ),
        )

        stripe_key = secretsmanager.Secret(
            self, "StripeKey", secret_name="tys-prod-stripe-api-key"
        )
        stripe_webhook = secretsmanager.Secret(
            self, "StripeWebhook", secret_name="tys-prod-stripe-webhook-secret"
        )
        resend_key = secretsmanager.Secret(
            self, "ResendKey", secret_name="tys-prod-resend-api-key"
        )
        admin_password = secretsmanager.Secret(
            self, "AdminPassword", secret_name="tys-prod-admin-password"
        )

        # ── RDS ────────────────────────────────────────────────────────
        db_sg = ec2.SecurityGroup(
            self, "RdsSg", vpc=vpc, description="RDS", allow_all_outbound=False
        )
        db_sg.add_ingress_rule(
            ec2.Peer.ipv4(vpc.vpc_cidr_block),
            ec2.Port.tcp(5432),
            "PostgreSQL",
        )

        db = rds.DatabaseInstance(
            self,
            "Rds",
            engine=rds.DatabaseInstanceEngine.postgres(
                version=rds.PostgresEngineVersion.VER_16_4
            ),
            instance_type=ec2.InstanceType.of(
                ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL
            ),
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
            ),
            security_groups=[db_sg],
            database_name="tys_production",
            credentials=rds.Credentials.from_generated_secret(
                "tys_admin", secret_name="tys-prod-rds-master"
            ),
            allocated_storage=50,
            storage_type=rds.StorageType.GP3,
            backup_retention=Duration.days(30),
            deletion_protection=True,
            removal_policy=RemovalPolicy.RETAIN,
            multi_az=True,
        )

        db_url = secretsmanager.CfnSecret(
            self, "DbUrl",
            name="tys-prod-database-url",
            secret_string=Fn.join("", [
                "postgresql+asyncpg://",
                db.secret.secret_value_from_json("username").unsafe_unwrap(),
                ":",
                db.secret.secret_value_from_json("password").unsafe_unwrap(),
                "@",
                db.db_instance_endpoint_address,
                ":",
                db.db_instance_endpoint_port,
                "/tys_production"
            ])
        )
        db_url_l2 = secretsmanager.Secret.from_secret_attributes(
            self, "DbUrlL2", secret_complete_arn=db_url.ref
        )

        # ── ECS ────────────────────────────────────────────────────────
        cluster = ecs.Cluster(self, "Cluster", vpc=vpc)

        task_role = iam.Role(
            self,
            "TaskRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        )
        for secret in [jwt_secret, db_url_l2, stripe_key, stripe_webhook, resend_key, admin_password]:
            secret.grant_read(task_role)

        cert = acm.Certificate.from_certificate_arn(
            self, "Cert", certificate_arn=cert_arn
        ) if cert_arn else None

        fargate = ecs_patterns.ApplicationLoadBalancedFargateService(
            self,
            "Fargate",
            cluster=cluster,
            cpu=1024,
            memory_limit_mib=2048,
            desired_count=1,
            certificate=cert,
            redirect_http=bool(cert),
            task_image_options=ecs_patterns.ApplicationLoadBalancedTaskImageOptions(
                image=ecs.ContainerImage.from_ecr_repository(repo),
                container_port=8000,
                task_role=task_role,
                environment={
                    "ENV": "production",
                    "PUBLIC_DOMAIN": domain_name or "ajcodelabs.ai",
                    "TYS_FEE_PERCENT": "5",
                    "STRIPE_API_BASE": "https://api.stripe.com",
                    "EMAIL_FROM": "noreply@ticketyourself.com",
                    "ADMIN_EMAIL": "admin@ticketyourself.com",
                },
                secrets={
                    "DATABASE_URL": ecs.Secret.from_secrets_manager(db_url_l2),
                    "JWT_SECRET": ecs.Secret.from_secrets_manager(jwt_secret),
                    "STRIPE_API_KEY": ecs.Secret.from_secrets_manager(stripe_key),
                    "STRIPE_WEBHOOK_SECRET": ecs.Secret.from_secrets_manager(
                        stripe_webhook
                    ),
                    "RESEND_API_KEY": ecs.Secret.from_secrets_manager(resend_key),
                    "ADMIN_PASSWORD": ecs.Secret.from_secrets_manager(admin_password),
                },
                enable_logging=True,
                log_driver=ecs.LogDrivers.aws_logs(
                    stream_prefix="backend",
                    log_retention=logs.RetentionDays.THREE_MONTHS,
                ),
            ),
            task_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
            ),
        )

        fargate.target_group.configure_health_check(
            path="/api/health",
            healthy_http_codes="200",
            interval=Duration.seconds(30),
            timeout=Duration.seconds(5),
            healthy_threshold_count=2,
            unhealthy_threshold_count=3,
        )

        cfn_service = fargate.service.node.default_child
        cfn_service.deployment_configuration = ecs.CfnService.DeploymentConfigurationProperty(
            deployment_circuit_breaker=ecs.CfnService.DeploymentCircuitBreakerProperty(
                enable=True,
                rollback=True,
            )
        )

        scaling = fargate.service.auto_scale_task_count(max_capacity=10, min_capacity=1)
        scaling.scale_on_cpu_utilization(
            "CpuScaling",
            target_utilization_percent=70,
            scale_in_cooldown=Duration.seconds(60),
            scale_out_cooldown=Duration.seconds(30),
        )
        scaling.scale_on_memory_utilization(
            "MemoryScaling",
            target_utilization_percent=80,
            scale_in_cooldown=Duration.seconds(60),
            scale_out_cooldown=Duration.seconds(30),
        )

        # ── Frontend ───────────────────────────────────────────────────
        frontend_bucket = s3.Bucket(
            self,
            "FrontendBucket",
            bucket_name="tys-prod-frontend",
            removal_policy=RemovalPolicy.RETAIN,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
        )

        oai = cloudfront.OriginAccessIdentity(self, "Oai", comment="tys-prod")
        frontend_bucket.grant_read(oai)

        cdn = cloudfront.Distribution(
            self,
            "CloudFront",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_identity(
                    frontend_bucket, origin_access_identity=oai
                ),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
            ),
            additional_behaviors={
                "/api/*": cloudfront.BehaviorOptions(
                    origin=origins.LoadBalancerV2Origin(
                        fargate.load_balancer,
                        protocol_policy=(
                            cloudfront.OriginProtocolPolicy.HTTPS_ONLY
                            if cert_arn
                            else cloudfront.OriginProtocolPolicy.HTTP_ONLY
                        ),
                    ),
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowed_methods=cloudfront.AllowedMethods.ALLOW_ALL,
                    cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                    origin_request_policy=cloudfront.OriginRequestPolicy.ALL_VIEWER,
                )
            },
            default_root_object="index.html",
            domain_names=[domain_name] if domain_name else None,
            certificate=acm.Certificate.from_certificate_arn(
                self, "CertRef", certificate_arn=cert_arn
            ) if cert_arn else None,
            error_responses=[
                cloudfront.ErrorResponse(
                    http_status=403,
                    response_page_path="/index.html",
                    response_http_status=200,
                ),
                cloudfront.ErrorResponse(
                    http_status=404,
                    response_page_path="/index.html",
                    response_http_status=200,
                ),
            ],
        )

        # ── Outputs ────────────────────────────────────────────────────
        CfnOutput(self, "AlbDns", value=fargate.load_balancer.load_balancer_dns_name)
        CfnOutput(self, "CdnUrl", value=cdn.distribution_domain_name)
        CfnOutput(self, "EcrRepo", value=repo.repository_uri)
        CfnOutput(self, "ClusterName", value=cluster.cluster_name)

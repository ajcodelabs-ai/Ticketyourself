#!/usr/bin/env python3
import aws_cdk as cdk
from tys_stack import TysStack

app = cdk.App()

env_name = app.node.try_get_context("env") or "staging"
domain_name = app.node.try_get_context("domain")
cert_arn = app.node.try_get_context("cert_arn")

TysStack(
    app,
    f"Tys{env_name.capitalize()}",
    env_name=env_name,
    domain_name=domain_name,
    certificate_arn=cert_arn,
    env=cdk.Environment(
        account=app.node.try_get_context("account"),
        region=app.node.try_get_context("region") or "us-east-1",
    ),
)

app.synth()

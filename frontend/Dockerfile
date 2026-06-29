FROM node:20-alpine AS base

WORKDIR /app

RUN corepack enable && corepack prepare yarn@1.22.22 --activate

FROM base AS deps

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

FROM base AS dev

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["yarn", "dev", "--host", "0.0.0.0"]

FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG VITE_BACKEND_URL=http://localhost:8000
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

RUN yarn build

FROM nginx:1.27-alpine AS prod

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

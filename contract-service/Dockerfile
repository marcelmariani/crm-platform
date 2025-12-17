FROM node:18-bullseye AS deps

# Instala libssl e jq necessários para MongoMemoryServer e validação de coverage
RUN apt-get update && apt-get install -y libssl1.1 jq

WORKDIR /usr/src/app

COPY package*.json ./

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

RUN if [ "$NODE_ENV" = "production" ]; \
    then npm install --production; \
    else npm install; \
    fi

COPY . .

EXPOSE 3011
CMD ["npm", "start"]

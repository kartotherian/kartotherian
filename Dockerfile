FROM debian:stretch
RUN apt-get update && apt-get install -y nodejs nodejs-legacy git wget python libcairo2-dev libjpeg62-turbo-dev libpango1.0-dev libgif-dev build-essential g++ libmapnik-dev && rm -rf /var/lib/apt/lists/*
ENV NVM_DIR /usr/local/nvm
RUN wget -qO- https://raw.githubusercontent.com/creationix/nvm/v0.33.6/install.sh | bash && . $NVM_DIR/nvm.sh && nvm install 6.11.1
ENV HOME=/root/ LINK=g++
ENV IN_DOCKER=1
COPY . /home/code
WORKDIR /home/code
RUN . $NVM_DIR/nvm.sh && nvm use 6.11.1 && npm install --build-from-source=mapnik --fallback-to-build=false && npm test

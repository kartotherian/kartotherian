FROM debian:stretch
RUN apt-get update && apt-get install -y nodejs nodejs-legacy git wget build-essential python libcairo2-dev libgif-dev libpango1.0-dev libjpeg62-turbo-dev apt-transport-https redis-server libmapnik-dev && rm -rf /var/lib/apt/lists/*
ENV NVM_DIR /usr/local/nvm
RUN wget -qO- https://raw.githubusercontent.com/creationix/nvm/v0.33.6/install.sh | bash && . $NVM_DIR/nvm.sh && nvm install 6.11.1
ENV HOME=/root/ LINK=g++
ENV IN_DOCKER=1
COPY . /home/code
WORKDIR /home/code
RUN . $NVM_DIR/nvm.sh && nvm use 6.11.1 && npm install --build-from-source=mapnik --fallback-to-build=false && (redis-server &) && npm test

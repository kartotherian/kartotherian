FROM debian:stretch
RUN apt-get update && apt-get install -y nodejs nodejs-legacy git wget python apt-transport-https redis-server build-essential && rm -rf /var/lib/apt/lists/*
RUN printf "deb https://apt.wikimedia.org/wikimedia stretch-wikimedia main backports" >> /etc/apt/sources.list
RUN wget -qO - "https://wikitech.wikimedia.org/w/index.php?title=APT_repository/Stretch-Key&action=raw" | apt-key add -
RUN apt-get update && apt-get install -y -t stretch-wikimedia libmapnik3.0 libmapnik-dev
ENV NVM_DIR /usr/local/nvm
RUN wget -qO- https://raw.githubusercontent.com/creationix/nvm/v0.33.6/install.sh | bash && . $NVM_DIR/nvm.sh && nvm install 6.11.1
ENV HOME=/root/ LINK=g++
ENV IN_DOCKER=1
COPY . /home/code
WORKDIR /home/code
RUN . $NVM_DIR/nvm.sh && nvm use 6.11.1 && npm install --build-from-source=mapnik --fallback-to-build=false && (redis-server &) && npm test

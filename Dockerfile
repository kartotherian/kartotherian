FROM buildpack-deps:jessie

# install node && npm
RUN apt-get update && apt-get install -y nodejs npm && rm -rf /var/lib/apt/lists/*
# link /usr/bin/node to /usr/bin/nodejs
RUN ln -s /usr/bin/nodejs /usr/bin/node

# copy the repo files over
RUN mkdir -p /opt/service
ADD . /opt/service
# install the dependencies
WORKDIR /opt/service
RUN npm install

# expose the default 6927 port
EXPOSE 6927

# start the server
CMD ["/usr/bin/npm", "start"]


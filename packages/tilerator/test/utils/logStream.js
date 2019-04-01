const bunyan = require('bunyan');

function logStream(logStdout) {
  const log = [];
  const parrot = bunyan.createLogger({
    name: 'test-logger',
    level: 'warn',
  });

  function write(chunk) {
    try {
      const entry = JSON.parse(chunk);
      const levelMatch = /^(\w+)/.exec(entry.levelPath);
      if (logStdout && levelMatch) {
        const level = levelMatch[1];
        if (parrot[level]) {
          parrot[level](entry);
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('something went wrong trying to parrot a log entry', e, chunk);
    }

    log.push(chunk);
  }

  // to implement the stream writer interface
  function end() {
  }

  function get() {
    return log;
  }

  function slice() {
    const begin = log.length;
    let end2 = null;

    function halt() {
      if (end2 === null) {
        end2 = log.length;
      }
    }

    function get2() {
      return log.slice(begin, end);
    }

    return {
      halt,
      get: get2,
    };
  }

  return {
    write,
    end,
    slice,
    get,
  };
}

module.exports = logStream;

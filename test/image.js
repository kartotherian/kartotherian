var fs = require('fs');
var util = require('util');
var path = require('path');
var spawn = require('child_process').spawn;
var exec = require('child_process').exec;
var existsSync = require('fs').existsSync || require('path').existsSync;
var mapnik = require('mapnik');

var image_magick_available = true;
var overwrite = false;

exec('compare -h', function(error, stdout, stderr) {
    if (error !== null) {
      image_magick_available = false;
    }
});

function imageEqualsFile(buffer, file, meanError, callback) {
    if (typeof meanError == 'function') {
        callback = meanError;
        meanError = 0.02;
    }

    var fixturesize = fs.statSync(file).size;
    var sizediff = Math.abs(fixturesize - buffer.length) / fixturesize;
    if (sizediff > meanError) {
        return callback(new Error('Image size is too different from fixture: ' + buffer.length + ' vs. ' + fixturesize));
    }
    var expectImage = new mapnik.Image.open(file);
    var resultImage = new mapnik.Image.fromBytesSync(buffer);
    var diff = expectImage.compare(resultImage);

    if (diff > 0) {
        fs.writeFileSync('/Users/r/tmp/wut.png', buffer, 'binary');
        callback(new Error('Image is too different from fixture: ' + diff));
    } else {
        callback();
    }
}

module.exports = imageEqualsFile;

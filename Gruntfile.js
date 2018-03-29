/* eslint-env node */
module.exports = function Gruntfile(grunt) {
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-eslint');

  grunt.initConfig({
    eslint: {
      code: {
        src: [
          '*.js',
          '!node_modules/**',
        ],
      },
    },
  });

  grunt.registerTask('lint', 'eslint');
  grunt.registerTask('test', 'lint');
  grunt.registerTask('default', 'test');
};

/* eslint-env node */
module.exports = function Gruntfile(grunt) {
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-eslint');
  grunt.loadNpmTasks('grunt-stylelint');

  grunt.initConfig({
    eslint: {
      code: {
        src: [
          '**/*.js',
          '!node_modules/**',
          '!vendor/**',
          '!tests/externals/**',
          '!static/lib/**',
        ],
      },
    },
    // Lint – Styling
    stylelint: {
      options: {
        syntax: 'less',
      },
      all: [
        'static/**/*.css',
        '!static/lib/**',
      ],
    },
  });

  grunt.registerTask('lint', ['eslint', 'stylelint']);
  grunt.registerTask('test', 'lint');
  grunt.registerTask('default', 'test');
};

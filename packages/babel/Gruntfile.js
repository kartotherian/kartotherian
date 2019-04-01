/* eslint-env node */
module.exports = function Gruntfile(grunt) {
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-eslint');
  grunt.loadNpmTasks('grunt-mocha-test');
  grunt.loadNpmTasks('grunt-tyops');

  grunt.initConfig({
    watch: {
      scripts: {
        files: ['**/*.js'],
        tasks: ['test'],
      },
    },
    eslint: {
      code: {
        src: [
          '**/*.js',
          '!node_modules/**',
        ],
      },
    },
    tyops: {
      options: {
        typos: '.typos.json',
      },
      src: [
        '**/*.js',
        '!node_modules/**',
      ],
    },
    mochaTest: {
      test: {
        options: {
          reporter: 'spec',
        },
        src: ['test/**/*.js'],
      },
    },
  });

  grunt.registerTask('lint', ['eslint']);
  grunt.registerTask('test', ['tyops', 'lint', 'mochaTest']);
  grunt.registerTask('default', 'test');
};

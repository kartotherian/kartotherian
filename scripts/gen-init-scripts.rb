#!/usr/bin/env ruby


require 'erb'
require 'json'
require 'yaml'


rootdir = File.expand_path(File.join(File.dirname(__FILE__), '..'))
indir = File.join(rootdir, 'dist', 'init-scripts')
outdir = indir


class ScriptData

  include ERB::Util

  @@suffix = {'systemd' => '.service', 'upstart' => '.conf'}
  
  def initialize input_dir
    @template = {}
    self.init input_dir
  end

  def set_info root_dir
    self.read_info(root_dir).each do |key, value|
      self.instance_variable_set "@#{key}".to_sym, value
    end
    @service_name = @name
    @no_file ||= 10000
  end

  def generate output_dir
    @template.each do |name, erb|
      File.open(File.join(output_dir, "#{@name}#{@@suffix[name]}"), 'w') do |io|
        io.write erb.result(binding())
      end
    end
  end

  def init input_dir
    Dir.glob(File.join(input_dir, '*.erb')).each do |fname|
      @template[File.basename(fname, '.erb')] = ERB.new(File.read(fname))
    end
  end

  def read_info root_dir
    data = YAML.load(File.read(File.join(root_dir, 'config.yaml')))['services'][0]['conf']
    return data.merge(JSON.load(File.read(File.join(root_dir, 'package.json'))))
  end

end


if ARGV.size > 0 and ['-h', '--help'].include? ARGV[0]
  puts 'This is a simple script to generate various service init scripts'
  puts 'Usage: gen-init-scripts.rb [output_dir]'
  exit 1
elsif ARGV.size > 0
  outdir = ARGV[0]
end

unless File.directory? outdir
  STDERR.puts 'The output directory must exist! Aborting...'
  exit 2
end

data = ScriptData.new indir
data.set_info rootdir
data.generate outdir


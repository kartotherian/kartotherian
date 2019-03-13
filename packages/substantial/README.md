[![Build Status](https://travis-ci.org/kartotherian/substantial.svg?branch=master)](https://travis-ci.org/kartotherian/substantial)

# @kartotherian/substantial
A filtering tile source for Kartotherian map tile server that only lets through tiles that have complex data,
 and should be saved to a database. Tiles that only contain one layer like water could be easily extracted
 from lower-level zoom (overzooming).

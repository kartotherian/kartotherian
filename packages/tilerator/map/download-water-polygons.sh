#!/bin/bash

cd "$( dirname "${BASH_SOURCE[0]}" )"

echo 'Downloading Mercator Water Polygons from http://openstreetmapdata.com/data/water-polygons'
wget http://data.openstreetmapdata.com/water-polygons-split-3857.zip

echo 'Unzipping and deleting water-polygons-split-3857.zip'
unzip water-polygons-split-3857 && rm water-polygons-split-3857.zip

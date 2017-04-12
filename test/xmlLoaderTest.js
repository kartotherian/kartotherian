'use strict';

let assert = require('assert'),
    XmlLoader = require('..').XmlLoader;

function test(opts, expected) {
    return () => {
        let loader = new XmlLoader(opts, (v, n) => v.ref);
        let xml = loader.update(opts.xml);
        assert.strictEqual(xml, expected);
    }
}

function xml(opts) {
    opts = opts || {};

    if (opts.source === undefined){
        opts.source = '<![CDATA[<a/>]]>';
    }
    const source = !opts.source ? '' : `\n    <Parameter name="source">${opts.source}</Parameter>`;

    const layerOptional = opts.excludeOptional ? '' : `
  <Layer name="layerOptional">
    <StyleName>Optional</StyleName>
  </Layer>`;

    // `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE Map[]>
    return `<Map srs="abc"${opts.attrs || ''}>
  <Parameters>
    <Parameter name="attribution"><![CDATA[<a/>]]></Parameter>${source}
  </Parameters>
  <Layer name="layerAlways">
    <StyleName>Always</StyleName>
  </Layer>${layerOptional}
</Map>`;
}

describe('xmlLoader', () => {

    it('unmodified', test({xml: 'abc'}, 'abc'));

    it('xmlSetParams', test({
        xml: xml(),
        xmlSetParams: {
            source: {ref: "sourceId"}
        }
    }, xml({source: 'sourceId'})));

    it('xmlSetParams new', test({
        xml: xml({source: null}),
        xmlSetParams: {
            source: {ref: "sourceId"}
        }
    }, xml({source: 'sourceId'})));

    it('xmlSetAttrs', test({
        xml: xml(),
        xmlSetAttrs: {
            attr: {ref: "abc"}
        }
    }, xml({attrs: ' attr="abc"'})));

    it('xmlLayers', test({
        xml: xml(),
        xmlLayers: ['layerAlways']
    }, xml({excludeOptional: true})));

    it('xmlExceptLayers', test({
        xml: xml(),
        xmlExceptLayers: ['layerOptional']
    }, xml({excludeOptional: true})));

});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const en = require('../src/i18n/en.json');
const pt = require('../src/i18n/pt-BR.json');
const messages = require('../src/i18n/messages.en.json');

test('language packs have matching keys and preserve interpolation values', () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(pt).sort());
    const placeholders = text => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
    for (const [source, english] of Object.entries(messages)) {
        assert.ok(english.trim(), `Empty translation: ${source}`);
        assert.deepEqual(placeholders(source), placeholders(english), `Lost interpolation in: ${source}`);
    }
});

test('all literal UI translation calls and operation descriptions have English entries', () => {
    const root = path.join(__dirname, '..', 'src');
    const files = ['App.jsx', ...['components', 'screens'].flatMap(dir => fs.readdirSync(path.join(root, dir)).filter(file => file.endsWith('.jsx')).map(file => `${dir}/${file}`))];
    for (const file of files) {
        const ast = parser.parse(fs.readFileSync(path.join(root, file), 'utf8'), {sourceType:'module',plugins:['jsx']});
        traverse(ast, {
            CallExpression(p) {
                if(p.node.callee.name === 'tr' && p.node.arguments[0]?.type === 'StringLiteral') {
                    const message = p.node.arguments[0].value;
                    assert.ok(Object.hasOwn(messages, message), `${file}: missing English message ${message}`);
                }
            },
            JSXText(p) {
                assert.ok(!/[áàâãéêíóôõúç]/i.test(p.node.value), `${file}: untranslated JSX text ${p.node.value.trim()}`);
            },
        });
    }
    for(const operation of require('./fixtures/operations.json')) {
        assert.ok(messages[operation.name], operation.name);
        assert.ok(messages[operation.description], operation.description);
    }
    const backend = fs.readFileSync(path.join(root, '../src-tauri/src/lib.rs'), 'utf8');
    const operations = backend.slice(backend.indexOf('fn operations()'), backend.indexOf('fn world()'));
    for(const match of operations.matchAll(/"(?:name|description|category)": "([^"]+)"/g)) {
        assert.ok(messages[match[1]], `Tauri operation: ${match[1]}`);
    }
});

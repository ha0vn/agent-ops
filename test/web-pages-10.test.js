import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const page of ['graph', 'wall']) {
  test(`${page}.html runs on live data`, () => {
    const h = readFileSync(new URL(`../web/${page}.html`, import.meta.url), 'utf8');
    assert.match(h, /AO\.live\(render\)/);
    assert.match(h, /AO\.header\('/);
    assert.match(h, /\/assets\/ao\.css/);
    assert.match(h, /\/assets\/live\.js/);
    assert.doesNotMatch(h, /AO_DATA|ao-data/);
    assert.doesNotMatch(h, /fonts\.googleapis\.com/);
    assert.doesNotMatch(h, /\/files\//);
    assert.doesNotMatch(h, /throw 0/);
  });
}
test('graph keeps the camera on live re-render', () => {
  const h = readFileSync(new URL('../web/graph.html', import.meta.url), 'utf8');
  assert.match(h, /draw\(first \|\| sig !== render\.sig\)/);
});

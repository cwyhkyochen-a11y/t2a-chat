/**
 * Tests for form-block-parser.js
 * 用 node 原生 assert 模块
 */
'use strict';

var assert = require('assert');
var parser = require('../public/form-block-parser.js');

var passed = 0;
var total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (e) {
    console.log('  ❌ ' + name);
    console.log('     ' + e.message);
  }
}

console.log('\n🧪 form-block-parser 单元测试\n');

// ─── 1. 正常解析 ────────────────────────────────────────────────────

test('完整表单解析', function () {
  var input = [
    'style: { label: "风格偏好", type: "select", options: ["极简","复古","赛博","不确定"], max: 1 }',
    'features: { label: "需要的功能", type: "select", options: ["登录","支付","搜索","推荐","通知"], max: 3 }',
    'budget: { label: "预算范围", type: "number", placeholder: "单位：元" }',
    'note: { label: "补充说明", type: "textarea", placeholder: "任何额外需求...", required: true }',
    'submit: "确认提交"'
  ].join('\n');

  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields.length, 4);
  assert.strictEqual(result.submitLabel, '确认提交');

  // style: select max=1 → radio
  assert.strictEqual(result.fields[0].id, 'style');
  assert.strictEqual(result.fields[0].type, 'select');
  assert.strictEqual(result.fields[0].mode, 'radio');
  assert.strictEqual(result.fields[0].max, 1);
  assert.deepStrictEqual(result.fields[0].options, ['极简', '复古', '赛博', '不确定']);

  // features: select max=3 → checkbox
  assert.strictEqual(result.fields[1].id, 'features');
  assert.strictEqual(result.fields[1].mode, 'checkbox');
  assert.strictEqual(result.fields[1].max, 3);

  // budget: number
  assert.strictEqual(result.fields[2].id, 'budget');
  assert.strictEqual(result.fields[2].type, 'number');
  assert.strictEqual(result.fields[2].placeholder, '单位：元');
  assert.strictEqual(result.fields[2].required, false);

  // note: textarea required
  assert.strictEqual(result.fields[3].id, 'note');
  assert.strictEqual(result.fields[3].type, 'textarea');
  assert.strictEqual(result.fields[3].required, true);
});

test('select max 省略 + options ≤ 2 → radio', function () {
  var input = 'confirm: { label: "确认?", type: "select", options: ["是","否"] }';
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields[0].mode, 'radio');
});

test('select max 省略 + options > 2 → checkbox', function () {
  var input = 'tags: { label: "标签", type: "select", options: ["A","B","C","D"] }';
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields[0].mode, 'checkbox');
});

test('submit 省略时默认 "提交"', function () {
  var input = 'name: { label: "姓名", type: "text" }';
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.submitLabel, '提交');
  assert.strictEqual(result.fields.length, 1);
});

// ─── 2. 缺字段 ─────────────────────────────────────────────────────

test('缺 label 时用 id 代替', function () {
  var input = 'foo: { type: "text" }';
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields[0].label, 'foo');
});

test('缺 type 时默认 text', function () {
  var input = 'bar: { label: "Bar" }';
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields[0].type, 'text');
});

test('缺 required 时默认 false', function () {
  var input = 'baz: { label: "Baz", type: "textarea" }';
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields[0].required, false);
});

// ─── 3. 嵌套引号 ───────────────────────────────────────────────────

test('单引号字符串', function () {
  var input = "name: { label: '姓名', type: 'text', placeholder: '输入姓名' }";
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields[0].label, '姓名');
  assert.strictEqual(result.fields[0].placeholder, '输入姓名');
});

test('转义引号', function () {
  var input = 'msg: { label: "说\\"你好\\"", type: "text" }';
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields[0].label, '说"你好"');
});

test('混合引号', function () {
  var input = 'x: { label: "It\'s fine", type: \'text\' }';
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields[0].label, "It's fine");
  assert.strictEqual(result.fields[0].type, 'text');
});

// ─── 4. 空 form ────────────────────────────────────────────────────

test('空字符串返回空 fields + 错误信息', function () {
  var result = parser.parseFormBlock('');
  assert.strictEqual(result.fields.length, 0);
  assert.strictEqual(result.submitLabel, '提交');
  assert.ok(result._error);
});

test('null 输入返回空 fields + 错误信息', function () {
  var result = parser.parseFormBlock(null);
  assert.strictEqual(result.fields.length, 0);
  assert.ok(result._error);
});

test('纯空白内容', function () {
  var result = parser.parseFormBlock('   \n\n  \t  ');
  assert.strictEqual(result.fields.length, 0);
  assert.strictEqual(result.submitLabel, '提交');
});

// ─── 5. 半成品 form ────────────────────────────────────────────────

test('尾随逗号容错', function () {
  var input = 'a: { label: "A", type: "text", }\nb: { label: "B", type: "text", }';
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields.length, 2);
});

test('不完整的对象（缺少右花括号）', function () {
  var input = 'x: { label: "X", type: "text"';
  var result = parser.parseFormBlock(input);
  // 应该尽量解析，不崩溃
  assert.strictEqual(result.fields.length, 1);
  assert.strictEqual(result.fields[0].label, 'X');
});

test('只有 submit 没有字段', function () {
  var input = 'submit: "开始"';
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields.length, 0);
  assert.strictEqual(result.submitLabel, '开始');
});

test('顶层 key 值为 bare ident（非 object）不生成字段', function () {
  var input = 'orphan: something\nname: { label: "Name", type: "text" }';
  var result = parser.parseFormBlock(input);
  // orphan 的值是 bare string 不是 object，不生成字段
  // name 正常解析
  assert.strictEqual(result.fields.length, 1);
  assert.strictEqual(result.fields[0].id, 'name');
});

// ─── 6. extractFormBlocks ───────────────────────────────────────────

test('从 markdown 中提取单个 form 块', function () {
  var md = '# Hello\n\nSome text\n\n```form\nname: { label: "名字", type: "text" }\nsubmit: "OK"\n```\n\nMore text';
  var blocks = parser.extractFormBlocks(md);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].parsed.fields.length, 1);
  assert.strictEqual(blocks[0].parsed.submitLabel, 'OK');
  assert.ok(typeof blocks[0].start === 'number');
  assert.ok(typeof blocks[0].end === 'number');
  assert.ok(blocks[0].raw.indexOf('name:') >= 0);
});

test('多个 form 块共存', function () {
  var md = [
    '# Page',
    '',
    '```form',
    'a: { label: "A", type: "text" }',
    'submit: "First"',
    '```',
    '',
    'Middle text',
    '',
    '```form',
    'b: { label: "B", type: "number" }',
    'submit: "Second"',
    '```',
    '',
    'End'
  ].join('\n');
  var blocks = parser.extractFormBlocks(md);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].parsed.submitLabel, 'First');
  assert.strictEqual(blocks[1].parsed.submitLabel, 'Second');
  assert.strictEqual(blocks[1].parsed.fields[0].type, 'number');
});

test('markdown 中没有 form 块', function () {
  var md = '# Hello\n\n```js\nconsole.log("hi")\n```';
  var blocks = parser.extractFormBlocks(md);
  assert.strictEqual(blocks.length, 0);
});

test('extractFormBlocks 空输入', function () {
  assert.deepStrictEqual(parser.extractFormBlocks(''), []);
  assert.deepStrictEqual(parser.extractFormBlocks(null), []);
});

// ─── 7. 边界情况 ───────────────────────────────────────────────────

test('数字值和布尔值', function () {
  var input = 'count: { label: "数量", type: "number", max: 100, required: true }';
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields[0].required, true);
});

test('嵌套数组包含数字', function () {
  var input = 'rating: { label: "评分", type: "select", options: [1, 2, 3, 4, 5], max: 1 }';
  var result = parser.parseFormBlock(input);
  assert.strictEqual(result.fields[0].mode, 'radio');
  assert.deepStrictEqual(result.fields[0].options, [1, 2, 3, 4, 5]);
});

test('submit 不是字符串时用默认值', function () {
  var input = 'submit: { something: true }\nname: { label: "N", type: "text" }';
  var result = parser.parseFormBlock(input);
  // submit value is an object, not string → ignored as submit, treated as field
  assert.strictEqual(result.submitLabel, '提交');
});

// ─── Summary ────────────────────────────────────────────────────────

console.log('\n────────────────────────────────');
console.log('结果: ' + passed + '/' + total + ' 通过');
if (passed === total) {
  console.log('🎉 全部通过!\n');
} else {
  console.log('⚠️  有 ' + (total - passed) + ' 个失败\n');
  process.exit(1);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { generationHistoryForm, generationImageBytes, readGenerationResponse } from '../../scripts/generation-output.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const dataUrl = bytes => `data:image/png;base64,${bytes.toString('base64')}`;

test('手机共用解析器在 final 正常结束却缺记账回执时保留图片并提示未知', async () => {
  const result = await readGenerationResponse(new Response(`event: final\ndata: ${JSON.stringify({ image: PNG.toString('base64'), seed: 7 })}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
  assert.deepEqual(result.bytes, PNG); assert.equal(result.seed, 7);
  assert.equal(result.accountingFailed, true);
  assert.match(result.accountingError, /未收到本地记账回执.*状态未确认/);
});


test('ZIP 与流式响应都只认最终成图并保留费用与清理回执', async () => {
  const zip = new JSZip();
  zip.file('generation.png', PNG);
  zip.file('metadata.json', JSON.stringify({ seed: 42 }));
  const zipped = await readGenerationResponse(new Response(await zip.generateAsync({ type: 'uint8array' }), {
    headers: {
      'content-type': 'application/zip',
      'X-Nai-Anlas-Estimated-Spent': '12',
      'X-Nai-Anlas-Accounting-Failed': '1',
      'X-Nai-Queue-Cleanup-Failed': '1',
    },
  }));
  assert.deepEqual([...zipped.bytes], [...PNG]);
  assert.equal(zipped.mime, 'image/png');
  assert.equal(zipped.seed, 42);
  assert.equal(zipped.estimatedCost, 12);
  assert.equal(zipped.accountingFailed, true);
  assert.match(zipped.cleanupError, /公共队列退出或释放失败/);

  const previews = [];
  const streamed = await readGenerationResponse(new Response([
    'event: intermediate\ndata: {"image":"' + PNG.toString('base64') + '","step_ix":0}\n\n',
    'event: final\ndata: {"image":"' + PNG.toString('base64') + '","seed":7}\n\n',
    'event: nai_usage\ndata: {"estimatedSpent":3}\n\n',
    'event: nai_usage_error\ndata: {"message":"本地用量结算失败"}\n\n',
    'event: nai_queue_cleanup_error\ndata: {"message":"公共队列退出或释放失败，请检查队列状态"}\n\n',
  ].join(''), { headers: { 'content-type': 'text/event-stream' } }), preview => previews.push(preview));
  assert.deepEqual([...streamed.bytes], [...PNG]);
  assert.equal(streamed.seed, 7);
  assert.equal(streamed.estimatedCost, 3);
  assert.equal(streamed.accountingFailed, true);
  assert.match(streamed.cleanupError, /公共队列/);
  assert.deepEqual(previews.map(preview => preview.step), [1, undefined]);
});

test('生图失败保留上游结构化原因，图片原料与历史表单共享同一校验', async () => {
  const failed = new Response(JSON.stringify({ error: '额度不足', code: 'quota_exhausted' }), { status: 402, headers: { 'content-type': 'application/json' } });
  await assert.rejects(() => readGenerationResponse(failed), error => error.code === 'quota_exhausted' && error.status === 402 && error.message === '额度不足');
  const emptyZip = new JSZip();
  emptyZip.file('metadata.json', '{}');
  await assert.rejects(async () => readGenerationResponse(new Response(await emptyZip.generateAsync({ type: 'uint8array' }), { headers: { 'content-type': 'application/zip' } })), /没有最终图片/);
  assert.throws(() => generationImageBytes('https://example.invalid/image.png'), /图片原料无效或过大/);

  const metadata = { id: 'synthetic-history', prompt: 'synthetic' };
  const form = generationHistoryForm({ bytes: PNG, mime: 'image/png' }, metadata, dataUrl(PNG));
  assert.equal(String(form.get('metadata')), JSON.stringify(metadata));
  assert.ok(form.get('image') instanceof Blob);
  assert.ok(form.get('editMask') instanceof Blob);
});

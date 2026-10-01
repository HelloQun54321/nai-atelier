/** 前后台共用待实测标记；实际生成成功后由现有保存流程摘除。 */
export const UNTESTED_CHAIN_TAG = '待实测';
export const isUntestedChain = (chain: { tags?: string[] } | null | undefined): boolean =>
  Boolean(chain && Array.isArray(chain.tags) && chain.tags.includes(UNTESTED_CHAIN_TAG));

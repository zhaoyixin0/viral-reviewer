/**
 * 占位 token：server 把它写进 draft JSON 的绝对路径位置，
 * setup 脚本在用户机器上做纯字面替换换成本机绝对路径。
 * 必须是绝不与真实路径/内容冲突的唯一串。
 */
export const TOKEN_PROJECT_DIR = "__VR_PROJECT_DIR__";
export const TOKEN_DRAFTS_DIR = "__VR_DRAFTS_DIR__";

/**
 * 用 Upstash Redis 保存：监控网址列表、暂停状态、上次运行结果
 */

const { Redis } = require("@upstash/redis");

const STATE_KEY = "monitor:state";

const DEFAULT_STATE = {
  paused: false,
  urls: [],
  lastRunAt: null,
  lastEmailAt: null,
  lastResults: [],
};

/** 检测环境变量是否存在（不暴露具体值） */
function getEnvCheck() {
  return {
    KV_REST_API_URL: !!process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: !!process.env.KV_REST_API_TOKEN,
    KV_URL: !!process.env.KV_URL,
    UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    REDIS_URL: !!process.env.REDIS_URL,
  };
}

/** 创建 Redis 客户端（兼容 Vercel 多种变量名） */
function getRedis() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    return new Redis({ url, token });
  }

  // 官方 SDK：自动读取 KV_* / UPSTASH_* 环境变量
  try {
    return Redis.fromEnv();
  } catch {
    return null;
  }
}

async function getState() {
  const envCheck = getEnvCheck();
  const redis = getRedis();

  if (!redis) {
    return { ...DEFAULT_STATE, _storageReady: false, _envCheck: envCheck };
  }

  try {
    await redis.ping();
    const data = await redis.get(STATE_KEY);
    const state = data ? { ...DEFAULT_STATE, ...data } : { ...DEFAULT_STATE };
    return { ...state, _storageReady: true, _envCheck: envCheck };
  } catch (err) {
    console.error("Redis ping/get error:", err);
    return {
      ...DEFAULT_STATE,
      _storageReady: false,
      _envCheck: envCheck,
      _redisError: err.message,
    };
  }
}

async function setState(state) {
  const redis = getRedis();
  if (!redis) {
    throw new Error("STORAGE_NOT_CONFIGURED");
  }
  const toSave = {
    paused: !!state.paused,
    urls: Array.isArray(state.urls) ? state.urls : [],
    lastRunAt: state.lastRunAt || null,
    lastEmailAt: state.lastEmailAt || null,
    lastResults: Array.isArray(state.lastResults) ? state.lastResults : [],
  };
  await redis.set(STATE_KEY, toSave);
  return toSave;
}

module.exports = { getState, setState, DEFAULT_STATE, getEnvCheck, getRedis };

// app.js
require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);
const app = express();

// subscribers 存檔路徑，只存群組
const SUB_FILE = path.join(__dirname, "subscribers.json");
let subscribers = [];
let lastSentMap = {}; // 記錄每個群組最後發送時間（防止頻繁推送）

// 讀取已訂閱群組，檔案不存在就建立
function loadSubscribers() {
  try {
    if (!fs.existsSync(SUB_FILE)) {
      subscribers = [];
      fs.writeFileSync(SUB_FILE, JSON.stringify(subscribers, null, 2));
      console.log("已建立空的 subscribers.json");
    } else {
      subscribers = JSON.parse(fs.readFileSync(SUB_FILE, "utf8"));
      if (!Array.isArray(subscribers)) subscribers = [];
    }
  } catch (err) {
    console.error("讀取 subscribers.json 錯誤", err);
    subscribers = [];
  }
}

// 儲存 subscribers
function saveSubscribers() {
  try {
    fs.writeFileSync(SUB_FILE, JSON.stringify(subscribers, null, 2));
  } catch (err) {
    console.error("寫入 subscribers.json 錯誤", err);
  }
}

// 建立訊息
function createMessage() {
  return {
    type: "text",
    text: "老闆在嗎？",
    quickReply: {
      items: [
        { type: "action", action: { type: "message", label: "在", text: "在" } },
        { type: "action", action: { type: "message", label: "不在", text: "不在" } },
        { type: "action", action: { type: "message", label: "準備離開", text: "準備離開" } }
      ],
    },
  };
}

// 發送訊息給群組（防止短時間重複）
async function sendToGroup(groupId) {
  const now = Date.now();
  const lastSent = lastSentMap[groupId] || 0;
  const MIN_INTERVAL = 60 * 1000; // 1 分鐘防重複（可調整）

  if (now - lastSent < MIN_INTERVAL) {
    return;
  }

  try {
    await client.pushMessage(groupId, createMessage());
    console.log("已推送「老闆在嗎？」給群組", groupId);
    lastSentMap[groupId] = now;
  } catch (err) {
    console.error("推送失敗 groupId=", groupId, err.originalError?.response?.data || err);
    if (err && err.statusCode && (err.statusCode === 403 || err.statusCode === 410)) {
      const idx = subscribers.indexOf(groupId);
      if (idx !== -1) {
        subscribers.splice(idx, 1);
        saveSubscribers();
        console.log("移除失效群組", groupId);
      }
    }
  }
}

loadSubscribers();

// LINE webhook endpoint
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end(); 
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).end();
  }
});

// event handler
async function handleEvent(event) {
  try {
    const source = event.source;
    const type = source.type;

    // Bot 被加入群組
    if (event.type === "join" && type === "group") {
      const groupId = source.groupId;
      if (!subscribers.includes(groupId)) {
        subscribers.push(groupId);
        saveSubscribers();
        console.log("加入訂閱(群組):", groupId);
      }
      // 回覆群組歡迎訊息
      await client.pushMessage(groupId, {
        type: "text",
        text: "大家好！之後有人發訊息就會收到「老闆在嗎？」",
      });
      return;
    }

    // 收到群組訊息
    if (event.type === "message" && type === "group" && event.message.type === "text") {
      const groupId = source.groupId;
      // 若新群組直接傳訊也視為訂閱
      if (!subscribers.includes(groupId)) {
        subscribers.push(groupId);
        saveSubscribers();
        console.log("加入訂閱(訊息觸發群組):", groupId);
      }

      const text = event.message.text.trim();

      // 如果有人回「在/不在」就回覆確認
      // if (text === "在" || text === "不在") {
      //   return client.replyMessage(event.replyToken, {
      //     type: "text",
      //     text: `已收到回覆：${text}（謝謝）`,
      //   });
      // }

      // 自動發送「老闆在嗎？」給該群組
      await sendToGroup(groupId);

      return;
    }

    return Promise.resolve(null);
  } catch (err) {
    console.error("handleEvent error:", err);
    return Promise.resolve(null);
  }
}

// cron 每天早上 09:00 發送「老闆在嗎？」到所有群組
cron.schedule(
  "0 9 * * *", // 測試每分鐘，正式用 "0 9 * * *"
  async () => {
    console.log(
      "排程觸發: 發送「老闆在嗎？」給全部群組",
      new Date().toLocaleString()
    );
    loadSubscribers();
    for (const groupId of subscribers) {
      await sendToGroup(groupId);
    }
  },
  { timezone: "Asia/Taipei" }
);

// 啟動 server
app.get("/", (req, res) => res.send("LINE bot is running"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

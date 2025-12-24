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

// 讀取已訂閱群組，若檔案不存在自動建立
function loadSubscribers() {
  try {
    if (fs.existsSync(SUB_FILE)) {
      subscribers = JSON.parse(fs.readFileSync(SUB_FILE, "utf8"));
      if (!Array.isArray(subscribers)) subscribers = [];
    } else {
      subscribers = [];
      fs.writeFileSync(SUB_FILE, JSON.stringify(subscribers, null, 2));
      console.log("已建立空的 subscribers.json");
    }
  } catch (err) {
    console.error("讀取 subscribers.json 錯誤", err);
    subscribers = [];
  }
}

function saveSubscribers() {
  try {
    fs.writeFileSync(SUB_FILE, JSON.stringify(subscribers, null, 2));
  } catch (err) {
    console.error("寫入 subscribers.json 錯誤", err);
  }
}

loadSubscribers();

// LINE webhook endpoint
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end(); // LINE webhook 必須回 200
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(200).end(); // 即使失敗也回 200
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
      // 可選回覆群組訊息
      return client.pushMessage(groupId, {
        type: "text",
        text: "大家好！每天早上會收到「老闆在嗎？」",
      });
    }

    // 收到群組訊息
    if (event.type === "message" && type === "group" && event.message.type === "text") {
      const text = event.message.text.trim();
      if (text === "在" || text === "不在") {
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `已收到回覆：${text}（謝謝）`,
        });
      }
    }

    return Promise.resolve(null);
  } catch (err) {
    console.error("handleEvent error:", err);
    return Promise.resolve(null);
  }
}

// cron 每天早上 09:00 發送「老闆在嗎？」到群組
cron.schedule(
  "*/1 * * * *", // 測試用每分鐘，正式用 "0 9 * * *"
  async () => {
    console.log(
      "排程觸發: 發送「老闆在嗎？」給全部群組",
      new Date().toLocaleString()
    );

    // 動態讀取最新群組清單
    try {
      if (fs.existsSync(SUB_FILE)) {
        subscribers = JSON.parse(fs.readFileSync(SUB_FILE, "utf8"));
        if (!Array.isArray(subscribers)) subscribers = [];
      } else {
        subscribers = [];
      }
    } catch (err) {
      console.error("讀取 subscribers.json 錯誤", err);
      subscribers = [];
    }

    console.log("群組訂閱清單:", subscribers);

    const message = {
      type: "text",
      text: "老闆在嗎？",
      quickReply: {
        items: [
          { type: "action", action: { type: "message", label: "在", text: "在" } },
          { type: "action", action: { type: "message", label: "不在", text: "不在" } },
        ],
      },
    };

    for (const groupId of subscribers.slice()) {
      try {
        await client.pushMessage(groupId, message);
        console.log("已推送給群組", groupId);
      } catch (err) {
        console.error(
          "推送失敗 groupId=",
          groupId,
          err.originalError?.response?.data || err
        );
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
  },
  { timezone: "Asia/Taipei" }
);

// 啟動 server
app.get("/", (req, res) => res.send("LINE bot is running"));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

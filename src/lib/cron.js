import cron from "cron";
import https from "https";

const job = new cron.CronJob("*/14 * * * *", function () {
  const url = process.env.API_URL
    ? `${process.env.API_URL}/api/health`
    : "https://react-native-app-mlpl.onrender.com/api/health";

  console.log(`⏰ Cron: Pinging ${url}`);

  const req = https.get(url, (res) => {
    let data = "";

    res.on("data", (chunk) => {
      data += chunk;
    });

    res.on("end", () => {
      if (res.statusCode === 200) {
        console.log("✅ Cron: Server is alive");
      } else {
        console.log(`⚠️ Cron: Server responded with status ${res.statusCode}`);
      }
    });
  });

  req.on("error", (e) => {
    console.error(`❌ Cron: Error pinging server: ${e.message}`);
  });

  req.end();
});

export default job;

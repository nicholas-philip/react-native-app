import cron from "cron";
import https from "https";

const job = new cron.CronJob("*/14 * * * *", function () {
  const req = https.get(process.env.API_URL, (res) => {
    if (res.statusCode === 200) {
      console.log("GET request sent successfully");
    } else {
      console.log(`GET request failed with status code: ${res.statusCode}`);
    }
  });

  req.on("error", (e) => {
    console.error(`Error making GET request: ${e.message}`);
  });
});

export default job;

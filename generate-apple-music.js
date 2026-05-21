const fs = require("fs");
const { chromium } =
  require("playwright");

const urls =
  require("./appleMusicUrls");

const songImages =
  require(
    "./songImages"
  );

const historyPath =
  "./apple-music-history.json";

const outputPath =
  "./apple-music.json";

const globalHistoryPath =
  "./global-history.json";

function getHistory() {

  try {

    if (
      fs.existsSync(
        historyPath
      )
    ) {

      return JSON.parse(
        fs.readFileSync(
          historyPath,
          "utf8"
        )
      );
    }

    return {
      lastUpdated:
        "",
      entries: []
    };

  } catch {

    return {
      lastUpdated:
        "",
      entries: []
    };
  }
}

function getGlobalHistory() {

  try {

    if (
      fs.existsSync(
        globalHistoryPath
      )
    ) {

      return JSON.parse(
        fs.readFileSync(
          globalHistoryPath,
          "utf8"
        )
      );
    }

    return {
      entries: []
    };

  } catch {

    return {
      entries: []
    };
  }
}

function isJiminSong(
  artist
) {

  return artist
    .toLowerCase()
    .includes(
      "jimin"
    );
}

async function scrapeCountry(
  page,
  country,
  url
) {

  console.log(
    `🌍 Scraping ${country}`
  );

  try {

    await page.goto(
      url,
      {
        waitUntil:
          "domcontentloaded",

        timeout:
          45000
      }
    );

    await page.waitForSelector(
      '[data-testid="track-list-item"]',
      {
        timeout:
          15000
      }
    );

    const entries =
      await page.evaluate(
        (
          country
        ) => {

          const songs =
            [];

          const rows =
            document.querySelectorAll(
              '[data-testid="track-list-item"]'
            );

          rows.forEach(
            (
              row,
              index
            ) => {

              const aria =
                row.getAttribute(
                  "aria-label"
                ) || "";

              const parts =
                aria
                  .split(",");

              const title =
                parts[0]
                  ?.trim() || "";

              const artist =
                parts[1]
                  ?.trim() || "";

              if (
                title
              ) {

                songs.push(
                  {
                    country,

                    rank:
                      index + 1,

                    title,

                    artist
                  }
                );
              }
            }
          );

          return songs;
        },
        country
      );

    console.log(
      `${country}: ${entries.length} songs`
    );

    return entries;

  } catch (
    err
  ) {

    console.log(
      `❌ ${country}:`,
      err.message
    );

    return [];
  }
}

async function generateAppleMusic() {

  const browser =
    await chromium.launch({
      headless: true
    });

  const context =
    await browser.newContext({
      viewport: {
        width: 1280,
        height: 720
      }
    });

  await context.route(
    "**/*",
    route => {

      const type =
        route
          .request()
          .resourceType();

      if (
        [
          "image",
          "font",
          "media"
        ].includes(
          type
        )
      ) {

        route.abort();

      } else {

        route.continue();
      }
    }
  );

  const history =
    getHistory();

  const globalHistory =
    getGlobalHistory();

  const previousEntries =
    history.entries ||
    [];

  const global =
    urls.find(
      item =>
        item.country ===
        "Global"
    );

  const globalPage =
    await context.newPage();

  const globalResults =
    await scrapeCountry(
      globalPage,
      global.country,
      global.url
    );

  await globalPage.close();

  const oldGlobal =
    JSON.stringify(
      globalHistory.entries
    );

  const newGlobal =
    JSON.stringify(
      globalResults.map(
        item => ({
          rank:
            item.rank,

          title:
            item.title
        })
      )
    );

  if (
    oldGlobal ===
    newGlobal
  ) {

    console.log(
      "🟰 Apple Music not updated yet"
    );

    await browser.close();

    return;
  }

  console.log(
    "📈 Global chart updated"
  );

  fs.writeFileSync(
    globalHistoryPath,
    JSON.stringify(
      {
        entries:
          globalResults.map(
            item => ({
              rank:
                item.rank,

              title:
                item.title
            })
          )
      },
      null,
      2
    )
  );

  const jiminEntries =
    [];

  const BATCH_SIZE =
    15;

for (
  let i = 0;
  i < urls.length;
  i += BATCH_SIZE
) {

  const batch =
    urls.slice(
      i,
      i + BATCH_SIZE
    );

  const results =
    await Promise.all(
      batch.map(
        async item => {

          const page =
            await context.newPage();

          const songs =
            await scrapeCountry(
              page,
              item.country,
              item.url
            );

          await page.close();

          return songs.filter(
            song =>
              isJiminSong(
                song.artist
              )
          );
        }
      )
    );

  jiminEntries.push(
    ...results.flat()
  );

  console.log(
    `✅ Batch ${
      Math.floor(
        i / BATCH_SIZE
      ) + 1
    } finished`
  );
}

const finalEntries =
  jiminEntries.map(
    current => {

      const previous =
        previousEntries.find(
          item =>
            item.country ===
              current.country &&
            item.title ===
              current.title
        );

      let status =
        "NEW";

      let change =
        "NEW";

      let previousRank =
        null;

      if (
        previous
      ) {

        previousRank =
          previous.rank;

        const diff =
          previous.rank -
          current.rank;

        if (
          diff > 0
        ) {

          status =
            "up";

          change =
            `+${diff}`;

        } else if (
          diff < 0
        ) {

          status =
            "down";

          change =
            `${diff}`;

        } else {

          status =
            "stable";

          change =
            "—";
        }

      } else {

        const appearedBefore =
          history
            .entries
            ?.some(
              old =>
                old.title ===
                  current.title &&
                old.country ===
                  current.country
            );

        if (
          appearedBefore
        ) {

          status =
            "RE";

          change =
            "RE";
        }
      }

      return {

        country:
          current.country,

        rank:
          current.rank,

        previousRank,

        change,

        status,

        title:
          current.title,

        artist:
          current.artist,

        image:
          songImages[
            current.title
          ] ||
          "/images/default.jpg"
      };
    }
  );

const today =
  new Date()
    .toLocaleDateString(
      "en-CA",
      {
        timeZone:
          "Asia/Jakarta"
      }
    );

const output =
  {
    updatedDate:
      today,

    totalEntries:
      finalEntries
        .length,

    entries:
      finalEntries.sort(
        (
          a,
          b
        ) =>
          a.rank -
          b.rank
      )
  };

const oldString =
  JSON.stringify(
    previousEntries.map(
      item => ({
        country:
          item.country,

        title:
          item.title,

        rank:
          item.rank
      })
    )
  );

const newString =
  JSON.stringify(
    finalEntries.map(
      item => ({
        country:
          item.country,

        title:
          item.title,

        rank:
          item.rank
      })
    )
  );

const chartChanged =
  oldString !==
  newString;

if (
  chartChanged
) {

  fs.writeFileSync(
    historyPath,
    JSON.stringify(
      {
        lastUpdated:
          today,

        entries:
          finalEntries
      },
      null,
      2
    )
  );

  console.log(
    "📈 Apple Music chart updated"
  );

} else {

  console.log(
    "🟰 No chart changes"
  );
}

fs.writeFileSync(
  outputPath,
  JSON.stringify(
    output,
    null,
    2
  )
);

console.log(
  `🔥 ${finalEntries.length} Jimin entries found`
);

await browser.close();
}

generateAppleMusic()
  .catch(
    console.error
  );

//  ███████████  ████                       █████                 █████
// ░░███░░░░░███░░███                      ░░███                 ░░███
//  ░███    ░███ ░███   ██████   ████████   ░███████    ██████   ███████
//  ░██████████  ░███  ░░░░░███ ░░███░░███  ░███░░███  ░░░░░███ ░░░███░
//  ░███░░░░░░   ░███   ███████  ░███ ░███  ░███ ░███   ███████   ░███
//  ░███         ░███  ███░░███  ░███ ░███  ░███ ░███  ███░░███   ░███ ███
//  █████        █████░░████████ ████ █████ ████ █████░░████████  ░░█████
// ░░░░░        ░░░░░  ░░░░░░░░ ░░░░ ░░░░░ ░░░░ ░░░░░  ░░░░░░░░    ░░░░░


export async function setupPlugin({ config, attachments, global }) {
  if (config.eventWhitelist) {
    global.eventWhitelist = config.eventWhitelist.split(",");
    console.info(`${global.eventWhitelist.length} events whitelisted`);
  }

  if (config.eventBlacklist) {
    global.eventBlacklist = config.eventBlacklist.split(",");
    console.info(`${global.eventBlacklist.length} events blacklisted`);
  }

  if (attachments.userWhitelist) {
    try {
      const whitelist = Buffer.from(attachments.userWhitelist.contents)
        .toString()
        .split("\n");
      if (whitelist.length > 0) {
        if (whitelist[0] === "externalId") {
          whitelist.shift();
        }
        global.userWhitelist = whitelist;
        console.info(`${whitelist.length} users whitelisted.`);
      }
    } catch (e) {
      console.error("Creation of User Whitelist Failed:", e);
    }
  }

  if (attachments.userBlacklist) {
    try {
      const blacklist = Buffer.from(attachments.userBlacklist.contents)
        .toString()
        .split("\n");
      if (blacklist.length > 0) {
        if (blacklist[0] === "externalId") {
          blacklist.shift();
        }
        global.userBlacklist = blacklist;
        console.info(`${blacklist.length} users blacklisted.`);
      }
    } catch (e) {
      console.error("Creation of User Blacklist Failed:", e);
    }
  }

  // TODO: Support whitelisting by Cohort
}

// TODO: Use exportEvents and API Bulk
export async function exportEvents(events, { cache, config }) {
  if (config.enableDebugLogs === "yes") {
    const sent = await cache.get("planhat:sent", 0);
    const skipped = await cache.get("planhat:skipped", 0);
    console.debug(`Stats | sent=${sent}, skipped=${skipped} | events=${events.length}`);
  }
}

export async function onSnapshot(snapshot) {
  console.warn("Snapshot", snapshot);
}

export async function onEvent(event, { cache, config, global }) {
  const user_id = event.properties?.$user_id ?? event.distinct_id;
  if (user_id) {
    const isEventWhitelisted =
      !Array.isArray(global.eventWhitelist) ||
      global.eventWhitelist.includes(event.event);
    const isEventBlacklisted =
      Array.isArray(global.eventBlacklist) &&
      global.eventBlacklist.includes(event.event);
    const isUserWhitelisted =
      !Array.isArray(global.userWhitelist) ||
      global.userWhitelist.includes(user_id);
    const isUserBlacklisted =
      Array.isArray(global.userBlacklist) &&
      global.userBlacklist.includes(user_id);

    if (config.enableDebugLogs === "yes") {
      console.debug(
        `DEBUG: Event for ${event.event} is ${JSON.stringify({
          isEventWhitelisted,
          isEventBlacklisted,
          isUserWhitelisted,
          isUserBlacklisted,
        })}`,
        event
      );
    }

    if (
      !isEventBlacklisted &&
      isEventWhitelisted &&
      !isUserBlacklisted &&
      isUserWhitelisted
    ) {
      try {
        const res = await fetch(
          `https://analytics.planhat.com/analytics/${config.planhatTenantToken}`,
          {
            method: "POST",
            body: JSON.stringify(toPlanhat(event)),
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
        if (!res.ok) {
          const text = await res.text();
          console.error(`Error: ${res.status} ${res.statusText} ${text}`);
        }
        await cache.incr("planhat:sent");
        return;
      } catch (e) {
        console.error("Error sending event to Planhat:", e);
      }
    }
  }
  await cache.incr("planhat:skipped");
}

// TODO: Mapping of event -> action
export function toPlanhat(event) {
  const action = event.event.toLowerCase().replace(/[^a-z]/g, "");
  const current_url =
    event.properties?.$pathname?.includes("auth") ? {}
      : { current_url: event.properties?.$current_url };
  return {
    action,
    externalId: event.properties?.$user_id ?? event.distinct_id,
    info: {
      ...current_url,
      host: event.properties?.$host,
      pathname: event.properties?.$pathname,
      os: event.properties?.$os ?? event.$set?.$os,
      browser: event.properties?.$browser ?? event.$set?.$browser,
      browser_version:
        event.properties?.$browser_version ?? event.$set?.$browser_version,
      screen_height: event.properties?.$screen_height,
      screen_width: event.properties?.$screen_width,
      viewport_height: event.properties?.$viewport_height,
      viewport_width: event.properties?.$viewport_width,
      initial_referrer:
        event.properties?.$initial_referrer ?? event.$set?.$initial_referrer,
      initial_referring_domain:
        event.properties?.$initial_referring_domain ??
        event.$set?.$initial_referring_domain,
      alias: event.properties?.alias,
      year: event.properties?.year,
      month: event.properties?.month,
      day: event.properties?.day,
      day_of_the_week: event.properties?.day_of_the_week,
    },
  };
}

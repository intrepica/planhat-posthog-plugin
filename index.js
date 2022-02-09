//  ███████████  ████                       █████                 █████
// ░░███░░░░░███░░███                      ░░███                 ░░███
//  ░███    ░███ ░███   ██████   ████████   ░███████    ██████   ███████
//  ░██████████  ░███  ░░░░░███ ░░███░░███  ░███░░███  ░░░░░███ ░░░███░
//  ░███░░░░░░   ░███   ███████  ░███ ░███  ░███ ░███   ███████   ░███
//  ░███         ░███  ███░░███  ░███ ░███  ░███ ░███  ███░░███   ░███ ███
//  █████        █████░░████████ ████ █████ ████ █████░░████████  ░░█████
// ░░░░░        ░░░░░  ░░░░░░░░ ░░░░ ░░░░░ ░░░░ ░░░░░  ░░░░░░░░    ░░░░░

export async function setupPlugin({ config, attachments, global, metrics }) {
  metrics.pluginLoads.increment(1);

  global.eventWhitelist = new Set(config.eventWhitelist ? config.eventWhitelist.split(",") : []);
  console.info(`${global.eventWhitelist.size} events whitelisted`);

  global.eventBlacklist = new Set(config.eventBlacklist ? config.eventBlacklist.split(",") : []);
  console.info(`${global.eventBlacklist.size} events blacklisted`);

  if (attachments.userWhitelist) {
    const attachedWhitelist = Buffer.from(attachments.userWhitelist.contents)
      .toString()
      .split("\n");
    if (attachedWhitelist.length > 0) {
      if (attachedWhitelist[0] === "externalId") {
        attachedWhitelist.shift();
      }
      global.userWhitelist = new Set(attachedWhitelist);
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
        global.userBlacklist = new Set(blacklist);
        console.info(`${blacklist.length} users blacklisted.`);
      }
    } catch (e) {
      console.error("Creation of User Blacklist Failed:", e);
    }
  } else {
    global.userBlacklist = new Set();
  }

  // TODO: Support whitelisting by Cohort
}

export const jobs = {
  flushBatch: async () => {

  }
};

export async function teardownPlugin({ global }) {
  if (global.buffer?.flush) {
    await global.buffer.flush();
  }
}

export async function exportEvents(events, { cache, config, global, metrics }) {
  if (config.enableDebugLogs === "yes") {
    console.debug(`Stats | events=${events.length}`);
  }

  metrics.totalEvents.increment(events.length);

  const userActivities = [];
  for (const event of events) {
    const user_id = event.properties?.$user_id ?? event.distinct_id;
    if (user_id) {
      const isEventWhitelisted =
        !global.eventWhitelist
        || global.eventWhitelist.size === 0
        || global.eventWhitelist.has(event.event);
      const isEventBlacklisted =
        global.eventBlacklist
        && global.eventBlacklist.size > 0
        && global.eventBlacklist.has(event.event);
      const isUserWhitelisted =
        !global.userWhitelist
        || global.userWhitelist.size === 0
        || global.userWhitelist.has(user_id);
      const isUserBlacklisted =
        global.userBlacklist
        && global.userBlacklist.size > 0
        && global.userBlacklist.has(user_id);

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
        userActivities.push(event);
      }
    }
  }

  if (userActivities.length > 0) {
    try {
      const res = await fetch(
        `https://analytics.planhat.com/analytics/bulk/${config.planhatTenantToken}`,
        {
          method: "POST",
          body: JSON.stringify(userActivities.map(toPlanhat)),
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
      if (!res.ok) {
        const text = await res.text();
        console.error(`Error: ${res.status} ${res.statusText} ${text}`);
      }
      metrics.maxBatchSize.max(userActivities.length);
      metrics.minBatchSize.min(userActivities.length);
      metrics.planhatEvents.increment(userActivities.length);
    } catch (e) {
      console.error("Error sending event to Planhat:", e);
    }
  }
}

// TODO: Customizable Mapping of event -> action
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

export const metrics = {
  pluginLoads: "sum",
  planhatEvents: "sum",
  totalEvents: "sum",
  maxBatchSize: "max",
  minBatchSize: "min",
  events_seen: "sum",
  events_delivered_successfully: "sum",
  retry_errors: "sum",
  other_errors: "sum",
  undelivered_events: "sum"
};

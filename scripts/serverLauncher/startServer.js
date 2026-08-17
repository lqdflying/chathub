const dns = require('node:dns').promises;
const fs = require('node:fs').promises;
const { spawn } = require('node:child_process');

// Set file paths
const DB_MIGRATION_SCRIPT_PATH = '/app/docker.cjs';
const SERVER_SCRIPT_PATH = '/app/server.js';
const PROXYCHAINS_CONF_PATH = '/etc/proxychains4.conf';

// Function to check if a string is a valid IP address
const isValidIP = (ip, version = 4) => {
  const ipv4Regex =
    /^(25[0-5]|2[0-4]\d|[01]?\d{1,2})(\.(25[0-5]|2[0-4]\d|[01]?\d{1,2})){3}$/;
  const ipv6Regex =
    /^(([\da-f]{1,4}:){7}[\da-f]{1,4}|([\da-f]{1,4}:){1,7}:|([\da-f]{1,4}:){1,6}:[\da-f]{1,4}|([\da-f]{1,4}:){1,5}(:[\da-f]{1,4}){1,2}|([\da-f]{1,4}:){1,4}(:[\da-f]{1,4}){1,3}|([\da-f]{1,4}:){1,3}(:[\da-f]{1,4}){1,4}|([\da-f]{1,4}:){1,2}(:[\da-f]{1,4}){1,5}|[\da-f]{1,4}:((:[\da-f]{1,4}){1,6})|:((:[\da-f]{1,4}){1,7}|:)|fe80:(:[\da-f]{0,4}){0,4}%[\da-z]+|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}\d){0,1}\d)\.){3}(25[0-5]|(2[0-4]|1{0,1}\d){0,1}\d)|([\da-f]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}\d){0,1}\d)\.){3}(25[0-5]|(2[0-4]|1{0,1}\d){0,1}\d))$/;

  switch (version) {
    case 4: {
      return ipv4Regex.test(ip);
    }
    case 6: {
      return ipv6Regex.test(ip);
    }
    default: {
      return ipv4Regex.test(ip) || ipv6Regex.test(ip);
    }
  }
};

// Function to parse protocol, host and port from a URL
const parseUrl = (url) => {
  const { protocol, hostname: host, port, username: user, password: pass } = new URL(url);
  return { host, pass, port: port || 443, protocol: protocol.replace(':', ''), user };
};

// Function to resolve host IP via DNS
const resolveHostIP = async (host, version = 4) => {
  try {
    const { address } = await dns.lookup(host, { family: version });

    if (!isValidIP(address, version)) {
      console.error(
        `❌ DNS Error: Invalid resolved IP: ${address}. IP address must be IPv${version}.`,
      );
      process.exit(1);
    }

    return address;
  } catch (err) {
    console.error(`❌ DNS Error: Could not resolve ${host}. Check DNS server:`);
    console.error(err);
    process.exit(1);
  }
};

// Function to generate proxychains configuration
const runProxyChainsConfGenerator = async (url) => {
  const { protocol, host, port, user, pass } = parseUrl(url);

  if (!['http', 'socks4', 'socks5'].includes(protocol)) {
    console.error(
      `❌ ProxyChains: Invalid protocol (${protocol}). Protocol must be 'http', 'socks4' and 'socks5'.`,
    );
    process.exit(1);
  }

  const validPort = parseInt(port, 10);
  if (isNaN(validPort) || validPort <= 0 || validPort > 65_535) {
    console.error(
      `❌ ProxyChains: Invalid port (${port}). Port must be a number between 1 and 65535.`,
    );
    process.exit(1);
  }

  let ip = isValidIP(host, 4) ? host : await resolveHostIP(host, 4);

  const proxyDNSConfig = process.env.ENABLE_PROXY_DNS === '1' ? `
proxy_dns
remote_dns_subnet 224
`.trim() : '';

  const configContent = `
localnet 127.0.0.0/8
localnet 10.0.0.0/8
localnet 172.16.0.0/12
localnet 192.168.0.0/16
localnet ::/127
${proxyDNSConfig}
strict_chain
tcp_connect_time_out 8000
tcp_read_time_out 15000
[ProxyList]
${protocol} ${ip} ${port} ${user} ${pass}
`.replace(/\n{2,}/g, '\n').trim();

  await fs.writeFile(PROXYCHAINS_CONF_PATH, configContent);
  console.log(`✅ ProxyChains: All outgoing traffic routed via ${url}.`);
  console.log('-------------------------------------');
};

// Function to execute a script with child process spawn
const runScript = (
  scriptPath,
  useProxy = false,
  { forwardSignals = false, parentProcess = process, spawnImpl = spawn } = {},
) => {
  const command = useProxy
    ? ['/bin/proxychains', '-q', '/bin/node', scriptPath]
    : ['/bin/node', scriptPath];
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command.shift(), command, { stdio: 'inherit' });
    const signalHandlers = new Map();

    const cleanup = () => {
      for (const [signal, handler] of signalHandlers) {
        parentProcess.off(signal, handler);
      }
      signalHandlers.clear();
    };

    if (forwardSignals) {
      for (const signal of ['SIGINT', 'SIGTERM']) {
        const handler = () => {
          if (child.exitCode === null && child.signalCode === null) child.kill(signal);
        };
        signalHandlers.set(signal, handler);
        parentProcess.on(signal, handler);
      }
    }

    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code, signal) => {
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }

      const error = new Error(
        signal ? `🔴 Process exited after ${signal}` : `🔴 Process exited with code ${code}`,
      );
      error.exitCode =
        code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
      reject(error);
    });
  });
};

// Main function to run the server with optional proxy
const runServer = async () => {
  const PROXY_URL = process.env.PROXY_URL || ''; // Default empty string to avoid undefined errors

  if (PROXY_URL) {
    await runProxyChainsConfGenerator(PROXY_URL);
    return runScript(SERVER_SCRIPT_PATH, true, { forwardSignals: true });
  }
  return runScript(SERVER_SCRIPT_PATH, false, { forwardSignals: true });
};

// Validate that at least one authentication method is configured.
// LobeHub is PostgreSQL-only — running without auth exposes all user data to anyone
// who can reach the URL. Fail fast rather than silently run in an insecure state.
const checkAuthConfig = () => {
  const hasNextAuth = process.env.NEXT_PUBLIC_ENABLE_NEXT_AUTH === '1';
  const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const hasToken = !!process.env.AUTH_TOKEN;

  if (hasNextAuth || hasClerk || hasToken) return; // at least one method configured

  console.error('');
  console.error('❌  AUTH CONFIGURATION REQUIRED');
  console.error('');
  console.error('   LobeHub requires at least one authentication method to be configured.');
  console.error('   Without auth, ALL routes are publicly accessible — anyone who can');
  console.error('   reach this URL can read and modify all data in the database.');
  console.error('');
  console.error('   Choose one of the following options:');
  console.error('');
  console.error('   Option 1 — Username/password login (recommended for single-user):');
  console.error('     NEXT_PUBLIC_ENABLE_NEXT_AUTH=1');
  console.error('     NEXT_AUTH_SECRET=<random-secret>');
  console.error('     NEXT_AUTH_SSO_PROVIDERS=credentials');
  console.error('     AUTH_CREDENTIALS_USERNAME=<your-username>');
  console.error('     AUTH_CREDENTIALS_PASSWORD=<your-password>');
  console.error('');
  console.error('   Option 2 — Token auth (API + browser login):');
  console.error('     NEXT_PUBLIC_ENABLE_NEXT_AUTH=1');
  console.error('     NEXT_AUTH_SECRET=<random-secret>');
  console.error('     NEXT_AUTH_SSO_PROVIDERS=credentials');
  console.error('     AUTH_TOKEN=<your-token>');
  console.error('');
  console.error('   Option 3 — OAuth provider (GitHub, Auth0, Authentik, etc.):');
  console.error('     NEXT_PUBLIC_ENABLE_NEXT_AUTH=1');
  console.error('     NEXT_AUTH_SECRET=<random-secret>');
  console.error('     NEXT_AUTH_SSO_PROVIDERS=github  # or auth0, authentik, etc.');
  console.error('');
  console.error('   See README.md → Authentication Modes for full configuration details.');
  console.error('');
  process.exit(1);
};

// Main execution block
const main = async () => {
  console.log('🌐 DNS Server:', dns.getServers());
  console.log('-------------------------------------');

  checkAuthConfig();

  // Run migrations whenever PostgreSQL is configured (DATABASE_URL).
  // Previously this gated on DATABASE_DRIVER only; omitting it skipped migrations while the
  // app still queried PG — causing missing-column errors after schema upgrades (e.g. 0043).
  if (process.env.DATABASE_URL) {
    try {
      await fs.access(DB_MIGRATION_SCRIPT_PATH);

      await runScript(DB_MIGRATION_SCRIPT_PATH);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(
          `⚠️ DB Migration: Not found ${DB_MIGRATION_SCRIPT_PATH}. Skipping DB migration. Ensure to migrate database manually.`,
        );
        console.log('-------------------------------------');
      } else {
        console.error('❌ Error during DB migration:');
        console.error(err);
        process.exit(1);
      }
    }
  }

  // Run the server in either database or non-database mode
  await runServer();
};

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = error?.exitCode || 1;
  });
}

module.exports = {
  main,
  runScript,
};

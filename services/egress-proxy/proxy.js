// Мост от контейнерной сети к прокси на loopback хоста.
//
// У контейнеров на этом сервере нет прямого выхода в интернет: наружу ходят
// через xray, который слушает только 127.0.0.1. Из bridge-сети такой адрес
// недоступен, а открывать xray на всех интерфейсах — значит выставить открытый
// прокси в интернет. Поэтому мост живёт в сети хоста, слушает строго на адресе
// docker-шлюза (снаружи он не виден) и пересылает соединения на loopback.
//
// Пересылаем байты как есть: xray — HTTP-прокси, клиенты общаются с ним
// методом CONNECT, и разбирать этот диалог мосту незачем.
const net = require('net');

// Адресов может быть несколько через запятую: host.docker.internal внутри
// контейнера указывает на шлюз default bridge (172.17.0.1), а сам контейнер
// живёт в отдельной сети со своим шлюзом. Слушаем оба, чтобы не гадать, каким
// адресом до нас достучатся.
const BIND_HOSTS = (process.env.BIND_HOST || '127.0.0.1').split(',').map((h) => h.trim()).filter(Boolean);
const BIND_PORT = Number(process.env.BIND_PORT || 1180);
const TARGET_HOST = process.env.TARGET_HOST || '127.0.0.1';
const TARGET_PORT = Number(process.env.TARGET_PORT || 1080);

const servers = BIND_HOSTS.map((host) => {
  const server = net.createServer((client) => {
    const upstream = net.connect(TARGET_PORT, TARGET_HOST);
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  });
  server.on('error', (err) => {
    console.error(`[egress-proxy] ${host}:${BIND_PORT} listen error`, err.message);
    process.exit(1);
  });
  server.listen(BIND_PORT, host, () => {
    console.log(`[egress-proxy] ${host}:${BIND_PORT} → ${TARGET_HOST}:${TARGET_PORT}`);
  });
  return server;
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    for (const s of servers) s.close();
    process.exit(0);
  });
}

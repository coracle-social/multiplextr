const {WebSocketServer} = require('ws')

const wss = new WebSocketServer({port: 8080})

wss.on('connection', ws => {
  console.log('Received connection')

  const sockets = {}

  ws.on('error', () => console.error(e))

  ws.on('close', () => console.log('connection closed'))

  ws.on('message', data => {
    try {
      data = JSON.parse(data)
    } catch (e) {
      ws.send(JSON.stringify(['NOTICE', '', 'Unable to parse message']))
    }

    console.log('received: %s', data)
  })
})

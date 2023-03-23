const {WebSocketServer} = require('ws')
const {RelayPool} = require('nostr-relaypool')

const wss = new WebSocketServer({port: 8080})

wss.on('connection', ws => {
  console.log('Received connection')

  // Connection-local data

  const pool = new RelayPool([])
  const subs = new Map()

  // Handlers

  ws.on('error', () => console.error(e))

  ws.on('close', () => console.log('connection closed'))

  ws.on('message', data => {
    try {
      const [relays, [verb, ...payload]] = JSON.parse(data)
      const handler = handlers[payload[0]]

      handler(relays, ...payload)
    } catch (e) {
      send('NOTICE', '', 'Unable to parse message')
    }

    console.log('received: %s', data)
  })

  // Utils

  const send = (...message) => ws.send(JSON.stringify(message))

  const handlers = {
    REQ(relays, subId, filters) {
      let eoseCount = 0

      // Close old subscription if subscriptionId already exists
      subs.get(subId)?.unsub()

      subs.set(subId, {
        unsub: this._pool.subscribe(
          [filters],
          relays,
          ({relayPool, relays, ...e}) => send("EVENT", subId, e),
          undefined,
          (events, relayURL) => {
            eoseCount++

            if (eoseCount === relays.length) {
              send("EOSE", subId)
            }
          }, {
            logAllEvents: false,
          }
        ),
      })
    },
    CLOSE(relays, subId) {
      subs.get(subId)?.unsub()
      subs.delete(subId)
    },
    EVENT(relays, event) {
      const unsub = pool.subscribe(
        [{ids: [event.id]}],
        relays,
        event => {
          send("OK", event.id, true, "")
          unsub()
        }
      )

      pool.publish(event, relays)

      setTimeout(unsub, 10_000)
    }
  }
})

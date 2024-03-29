const dotenv = require('dotenv')
const Bugsnag = require('@bugsnag/js')
const {WebSocketServer} = require('ws')
const {Pool, Relays, Executor} = require('paravel')

dotenv.config()

Bugsnag.start({
  apiKey: process.env.BUGSNAG_API_KEY,
  onError: event => {
    const message = event.errors[0].errorMessage

    if (message.includes('Unexpected server response')) {
      return false
    }

    if (message.includes('Invalid URL')) {
      return false
    }

    if (event.errors[0].errorMessage.match(/ETIMEDOUT|EPROTO/)) {
      return false
    }

    return event
  },
})

const pid = Math.random().toString().slice(2, 8)
const wss = new WebSocketServer({port: process.env.PORT})

let connCount = 0

wss.on('connection', socket => {
  connCount += 1

  console.log('Received connection', {pid, connCount})

  const plextr = new Multiplexer(socket)

  socket.on('message', msg => plextr.handle(msg))
  socket.on('error', e => console.error("Received error on client socket", e))
  socket.on('close', () => {
    plextr.cleanup()

    connCount -= 1

    console.log('Closing connection', {pid, connCount})
  })
})

class Multiplexer {
  constructor(socket) {
    this._socket = socket
    this._pool = new Pool()
    this._subs = new Map()
    this._errorCount = 0
  }
  cleanup() {
    this._socket.close()
    this._pool.clear()
    this._subs.clear()
  }
  send(urls, message) {
    this._socket.send(JSON.stringify([{relays: urls}, message]))
  }
  handle(message) {
    try {
      message = JSON.parse(message)
    } catch (e) {
      this._errorCount += 1
      this.send([], ['NOTICE', '', 'Unable to parse message'])
    }

    let urls, verb, payload
    try {
      [{relays: urls}, [verb, ...payload]] = message
    } catch (e) {
      this._errorCount += 1
      this.send([], ['NOTICE', '', 'Unable to read message'])
    }

    const handler = this[`on${verb}`]

    if (handler) {
      handler.call(this, Array.from(new Set(urls)), ...payload)
    } else {
      this.send([], ['NOTICE', '', 'Unable to handle message'])
    }

    // Drop spurious connections, some people put the multiplexer as their relay
    if (this._errorCount > 10) {
      console.log("Closing connection due to errors")
      this.cleanup()
    }
  }
  getExecutor(urls) {
    const sockets = urls.map(url => this._pool.get(url))
    const target = new Relays(sockets)
    const executor = new Executor(target)

    executor.handleAuth({
      onAuth: (url, challenge) => {
        this.send([url], ['AUTH', challenge])
      },
      onOk: (url, id, ok, message) => {
        this.send([url], ['OK', id, ok, message])
      },
    })

    return executor
  }
  onCLOSE(urls, subId) {
    this._subs.get(subId)?.unsubscribe()
    this._subs.delete(subId)
  }
  onREQ(urls, subId, ...filters) {
    const seen = new Set()
    const executor = this.getExecutor(urls)

    // Close old subscription if subscriptionId already exists
    this._subs.get(subId)?.unsubscribe()

    const sub = executor.subscribe(filters, {
      onEvent: (url, event) => {
        if (!seen.has(event.id)) {
          this.send([url], ['EVENT', subId, event])
        }

        seen.add(event.id)
      },
      onEose: url => {
        this.send([url], ['EOSE', subId])
      },
    })

    this._subs.set(subId, {
      unsubscribe: () => {
        sub.unsubscribe()
        executor.target.cleanup()
      },
    })
  }
  onEVENT(urls, event, verb = 'EVENT') {
    const executor = this.getExecutor(urls)

    const sub = executor.publish(event, {
      verb,
      onOk: (url, ...args) => {
        this.send([url], ['OK', ...args])
      },
      onError: (url, ...args) => {
        this.send([url], ['ERROR', ...args])
      },
    })

    setTimeout(() => {
      sub.unsubscribe()
      executor.target.cleanup()
    }, 10_000)
  }
  onAUTH(urls, event) {
    this.onEVENT(urls, event, 'AUTH')
  }
  onCOUNT(urls, subId, ...filters) {
    const executor = this.getExecutor(urls)

    // Close old subscription if subscriptionId already exists
    this._subs.get(subId)?.unsubscribe()

    const sub = executor.count(filters, {
      onCount: (url, ...payload) => {
        this.send([url], ['COUNT', subId, ...payload])
      },
    })

    this._subs.set(subId, {
      unsubscribe: () => {
        sub.unsubscribe()
        executor.target.cleanup()
      },
    })
  }
}


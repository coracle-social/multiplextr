const dotenv = require('dotenv')
const {WebSocketServer} = require('ws')
const {Pool, Relays, Executor} = require('paravel')

dotenv.config()

process.on('uncaughtException', err => {
  console.log("Uncaught error", err)
})

const wss = new WebSocketServer({port: process.env.PORT})

wss.on('connection', socket => {
  console.log('Received connection')

  const plextr = new Multiplexer(socket)

  socket.on('error', e => console.error("Received error on client socket", e))
  socket.on('close', () => plextr.cleanup())
  socket.on('message', msg => plextr.handle(msg))
})

class Multiplexer {
  constructor(socket) {
    this._socket = socket
    this._pool = new Pool()
    this._subs = new Map()
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
      this.send([], ['NOTICE', '', 'Unable to parse message'])
    }

    const [{relays: urls}, [verb, ...payload]] = message
    const handler = this[`on${verb}`]

    if (handler) {
      handler.call(this, Array.from(new Set(urls)), ...payload)
    } else {
      this.send([], ['NOTICE', '', 'Unable to handle message'])
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
  onEVENT(urls, event) {
    const executor = this.getExecutor(urls)

    executor.publish(event, {
      onOk: (url, ...args) => {
        this.send([url], ['OK', ...args])

        executor.target.cleanup()
      },
      onError: (url, ...args) => {
        this.send([url], ['ERROR', ...args])

        executor.target.cleanup()
      },
    })
  }
}


# Multiplextr

A dynamic relay proxy for nostr. Easy to self-host, easy to connect to.

# How it works

A multiplexer needs additional information about how to route messages to and from a client, so it uses a wrapped variant of the nostr protocol. Every message is a JSON-encoded array, where first entry is multiplexer metadata, and the second is a nostr message.

For example, a client might send `[{"relays": ["wss://my-relay.example.com", "wss://my-other-relay.example.com"]}, ["REQ", "my-subscription", <filter>]]`. Multiplextr will unwrap that message and send the subscription along to the relay specified. When receiving a response, it will wrap it and send it back to the client, for example, an event received from my-other-relay would be sent to the client as `[{"relays": ["wss://my-other-relay.example.com"]}, ["EVENT", <event>]]`.

This is quite easy to implement using the [paravel](https://github.com/coracle-social/paravel) library for building nostr clients (and relay tools like this one).

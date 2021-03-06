var common = require('../common');
var join = require('path').join;
var net = require('net');
var assert = require('assert');
var fs = require('fs');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

// FIXME: Avoid the common PORT as this test currently hits a C-level
// assertion error with node_g. The program aborts without HUPing
// the openssl s_server thus causing many tests to fail with
// EADDRINUSE.
var PORT = common.PORT + 5;

var connections = 0;

var keyfn = join(common.fixturesDir, "agent.key");
var key = fs.readFileSync(keyfn).toString();

var certfn = join(common.fixturesDir, "agent.crt");
var cert = fs.readFileSync(certfn).toString();

var server = spawn('openssl', ['s_server',
                               '-accept', PORT,
                               '-cert', certfn,
                               '-key', keyfn]);
server.stdout.pipe(process.stdout);
server.stderr.pipe(process.stdout);


function watchForAccept (d) {
  if (/ACCEPT/g.test(d.toString())) {
    server.stdout.removeListener('data', watchForAccept);
    startClient();
  }
}

var state = "WAIT-ACCEPT";

server.stdout.on('data', function (d) {
  switch (state) {
    case "WAIT-ACCEPT":
      if (/ACCEPT/g.test(d.toString())) {
        startClient();
        state = "WAIT-HELLO"
      }
      break;

    case "WAIT-HELLO":
      if (/hello/g.test(d.toString())) {

        // End the current SSL connection and exit.
        // See s_server(1ssl).
        server.stdin.write("Q");

        state = "WAIT-SERVER-CLOSE";
      }
      break;

    default:
      break;
  }
});


var serverExitCode = -1;
server.on('exit', function (code) {
  serverExitCode = code;
});


function startClient () {
  var s = new net.Stream();

  var sslcontext = crypto.createCredentials({key: key, cert: cert});
  sslcontext.context.setCiphers('RC4-SHA:AES128-SHA:AES256-SHA');

  var pair = crypto.createPair(sslcontext, false);

  assert.ok(pair.encrypted.writable);
  assert.ok(pair.cleartext.writable);

  pair.encrypted.pipe(s);
  s.pipe(pair.encrypted);

  s.connect(PORT);

  s.on('connect', function () {
    console.log("client connected");
  });

  pair.on('secure', function () {
    console.log('client: connected+secure!');
    console.log('client pair.getPeerCertificate(): %j', pair.getPeerCertificate());
    console.log('client pair.getCipher(): %j', pair.getCipher());
    setTimeout(function () {
      pair.cleartext.write('hello\r\n');
    }, 500);
  });

  pair.cleartext.on('data', function (d) {
    console.log("cleartext: %s", d.toString());
  });

  s.on('close', function () {
    console.log("client close");
  });

  pair.encrypted.on('error', function(err) {
    console.log('encrypted error: ' + err);
  });

  s.on('error', function(err) {
    console.log('socket error: ' + err);
  });

  pair.on('error', function(err) {
    console.log('secure error: ' + err);
  });
}


process.on('exit', function () {
  assert.equal(0, serverExitCode);
  assert.equal("WAIT-SERVER-CLOSE", state);
});

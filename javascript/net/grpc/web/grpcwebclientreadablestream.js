/**
 * @fileoverview gRPC web client Readable Stream
 *
 * This class is being returned after a gRPC streaming call has been
 * started. This class provides functionality for user to operates on
 * the stream, e.g. set onData callback, etc.
 *
 * This wraps the underlying goog.net.streams.NodeReadableStream
 *
 * @author stanleycheung@google.com (Stanley Cheung)
 */
goog.provide('grpc.web.GrpcWebClientReadableStream');


goog.require('goog.crypt.base64');
goog.require('goog.events');
goog.require('goog.net.EventType');
goog.require('goog.net.XhrIo');
goog.require('goog.net.XmlHttp');
goog.require('grpc.web.ClientReadableStream');
goog.require('grpc.web.GrpcWebStreamParser');
goog.require('grpc.web.StatusCode');



const GRPC_STATUS = "grpc-status";
const GRPC_STATUS_MESSAGE = "grpc-message";


/**
 * A stream that the client can read from. Used for calls that are streaming
 * from the server side.
 *
 * @template RESPONSE
 * @constructor
 * @implements {grpc.web.ClientReadableStream}
 * @final
 * @param {!goog.net.XhrIo} xhr The XhrIo object
 */
grpc.web.GrpcWebClientReadableStream = function(xhr) {
  /**
   * @private
   * @type {!goog.net.XhrIo} The XhrIo object
   */
  this.xhr_ = xhr;

  /**
   * @private
   * @type {function(?):!RESPONSE|null} The deserialize function for the proto
   */
  this.responseDeserializeFn_ = null;

  /**
   * @private
   * @type {function(!RESPONSE)|null} The data callback
   */
  this.onDataCallback_ = null;

  /**
   * @private
   * @type {function(!grpc.web.Status)|null} The status callback
   */
  this.onStatusCallback_ = null;

  /**
   * @private
   * @type {function(...):?|null} The stream end callback
   */
  this.onEndCallback_ = null;

  /**
   * @private
   * @type {number} The stream parser position
   */
  this.pos_ = 0;

  /**
   * @private
   * @type {!grpc.web.GrpcWebStreamParser} The grpc-web stream parser
   */
  this.parser_ = new grpc.web.GrpcWebStreamParser();

  var self = this;
  goog.events.listen(this.xhr_, goog.net.EventType.READY_STATE_CHANGE,
                     function(e) {
    var FrameType = grpc.web.GrpcWebStreamParser.FrameType;

    var responseText = self.xhr_.getResponseText();
    var newPos = responseText.length - responseText.length % 4;
    var newData = responseText.substr(self.pos_, newPos - self.pos_);
    if (newData.length == 0) return;
    self.pos_ = newPos;

    var byteSource = goog.crypt.base64.decodeStringToUint8Array(newData);
    var messages = self.parser_.parse([].slice.call(byteSource));
    if (!messages) return;

    for (var i = 0; i < messages.length; i++) {
      if (FrameType.DATA in messages[i]) {
        var data = messages[i][FrameType.DATA];
        if (data) {
          var response = self.responseDeserializeFn_(data);
          if (response) {
            self.onDataCallback_(response);
          }
        }
      }
      if (FrameType.TRAILER in messages[i]) {
        if (messages[i][FrameType.TRAILER].length > 0) {
          var trailerString = "";
          for (var pos = 0; pos < messages[i][FrameType.TRAILER].length;
            pos++) {
            trailerString += String.fromCharCode(
              messages[i][FrameType.TRAILER][pos]);
          }
          var trailers = self.parseHttp1Headers_(trailerString);
          var grpcStatusCode = grpc.web.StatusCode.OK;
          var grpcStatusMessage = "";
          if (GRPC_STATUS in trailers) {
            grpcStatusCode = trailers[GRPC_STATUS];
          }
          if (GRPC_STATUS_MESSAGE in trailers) {
            grpcStatusMessage = trailers[GRPC_STATUS_MESSAGE];
          }
          if (self.onStatusCallback_) {
            self.onStatusCallback_({
              code: Number(grpcStatusCode),
              details: grpcStatusMessage,
              metadata: trailers,
            });
          }
        }
      }
    }

    var readyState = self.xhr_.getReadyState();
    if (readyState == goog.net.XmlHttp.ReadyState.COMPLETE) {
      if (self.onEndCallback_) {
        self.onEndCallback_();
      }
      return;
    }
  });
};


/**
 * @override
 */
grpc.web.GrpcWebClientReadableStream.prototype.on = function(
    eventType, callback) {
  // TODO(stanleycheung): change eventType to @enum type
  if (eventType == 'data') {
    this.onDataCallback_ = callback;
  } else if (eventType == 'status') {
    this.onStatusCallback_ = callback;
  } else if (eventType == 'end') {
    this.onEndCallback_ = callback;
  }
  return this;
};


/**
 * Register a callbackl to parse the response
 *
 * @param {function(?):!RESPONSE} responseDeserializeFn The deserialize
 *   function for the proto
 */
grpc.web.GrpcWebClientReadableStream.prototype.setResponseDeserializeFn =
  function(responseDeserializeFn) {
  this.responseDeserializeFn_ = responseDeserializeFn;
};


/**
 * @override
 */
grpc.web.GrpcWebClientReadableStream.prototype.cancel = function() {
  this.xhr_.abort();
};


/**
 * Parse HTTP headers
 *
 * @private
 * @param {!string} str The raw http header string
 * @return {!Object} The header:value pairs
 */
grpc.web.GrpcWebClientReadableStream.prototype.parseHttp1Headers_ =
  function(str) {
  var chunks = str.trim().split("\r\n");
  var headers = {};
  for (var i = 0; i < chunks.length; i++) {
    var pos = chunks[i].indexOf(":");
    headers[chunks[i].substring(0, pos).trim()] =
      chunks[i].substring(pos+1).trim();
  }
  return headers;
};
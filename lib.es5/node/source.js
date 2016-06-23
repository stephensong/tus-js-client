"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getSource = getSource;

var _stream = require("stream");

var _fs = require("fs");

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var BufferSource = function () {
  function BufferSource(buffer) {
    _classCallCheck(this, BufferSource);

    this._buffer = buffer;
    this.size = buffer.length;
  }

  _createClass(BufferSource, [{
    key: "slice",
    value: function slice(start, end) {
      var buf = this._buffer.slice(start, end);
      buf.size = buf.length;
      return buf;
    }
  }, {
    key: "close",
    value: function close() {}
  }]);

  return BufferSource;
}();

var FileSource = function () {
  function FileSource(stream) {
    _classCallCheck(this, FileSource);

    this._stream = stream;
    this._path = stream.path.toString();
  }

  _createClass(FileSource, [{
    key: "slice",
    value: function slice(start, end) {
      var stream = (0, _fs.createReadStream)(this._path, {
        start: start,
        end: end,
        autoClose: true
      });
      stream.size = end - start;
      return stream;
    }
  }, {
    key: "close",
    value: function close() {
      this._stream.destroy();
    }
  }]);

  return FileSource;
}();

var StreamSource = function () {
  function StreamSource(stream, chunkSize) {
    _classCallCheck(this, StreamSource);

    // Ensure that chunkSize is an integer and not something else or Infinity.
    chunkSize = +chunkSize;
    if (!isFinite(chunkSize)) {
      throw new Error("cannot create source for stream without a finite value for the `chunkSize` option");
    }

    this._stream = stream;

    // Setting the size to null indicates that we have no calculation available
    // for how much data this stream will emit requiring the user to specify
    // it manually (see the `uploadSize` option).
    this.size = null;

    stream.pause();

    this._buf = new Buffer(chunkSize);
    this._bufPos = null;
    this._bufLen = 0;
  }

  _createClass(StreamSource, [{
    key: "slice",
    value: function slice(start, end) {
      // Always attempt to drain the buffer first, even if this means that we
      // return less data, then the caller requested.
      if (start >= this._bufPos && start < this._bufPos + this._bufLen) {
        var bufStart = start - this._bufPos;
        var bufEnd = Math.min(this._bufLen, end - this._bufPos);
        var buf = this._buf.slice(bufStart, bufEnd);
        buf.size = buf.length;
        return buf;
      }

      // Fail fast if the caller requests a proportion of the data which is not
      // available any more.
      if (start < this._bufPos) {
        throw new Error("cannot slice from position which we already seeked away");
      }

      this._bufPos = start;
      this._bufLen = 0;

      var bytesToSkip = start - this._bufPos;
      var bytesToRead = end - start;
      var slicingStream = new SlicingStream(bytesToSkip, bytesToRead, this);
      this._stream.pipe(slicingStream);
      slicingStream.size = bytesToRead;
      return slicingStream;
    }
  }, {
    key: "close",
    value: function close() {
      //this._stream.
    }
  }]);

  return StreamSource;
}();

var SlicingStream = function (_Transform) {
  _inherits(SlicingStream, _Transform);

  function SlicingStream(bytesToSkip, bytesToRead, source) {
    _classCallCheck(this, SlicingStream);

    // The number of bytes we have to discard before we start emitting data.

    var _this = _possibleConstructorReturn(this, Object.getPrototypeOf(SlicingStream).call(this));

    _this._bytesToSkip = bytesToSkip;
    // The number of bytes we will emit in the data events before ending this stream.
    _this._bytesToRead = bytesToRead;
    // Points to the StreamSource object which created this SlicingStream.
    // This reference is used for manipulating the _bufLen and _buf properties
    // directly.
    _this._source = source;
    return _this;
  }

  _createClass(SlicingStream, [{
    key: "_transform",
    value: function _transform(chunk, encoding, callback) {
      // Calculate the number of bytes we still have to skip before we can emit data.
      var bytesSkipped = Math.min(this._bytesToSkip, chunk.length);
      this._bytesToSkip -= bytesSkipped;

      // Calculate the number of bytes we can emit after we skipped enough data.
      var bytesAvailable = chunk.length - bytesSkipped;

      // If no bytes are available, because the entire chunk was skipped, we can
      // return earily.
      if (bytesAvailable === 0) {
        callback(null);
        return;
      }

      var bytesToRead = Math.min(this._bytesToRead, bytesAvailable);
      this._bytesToRead -= bytesToRead;

      if (bytesToRead !== 0) {
        var data = chunk.slice(bytesSkipped, bytesSkipped + bytesToRead);
        this._source._bufLen += data.copy(this._source._buf, this._source._bufLen);
        this.push(data);
      }

      // If we do not have to read any more bytes for this transform stream, we
      // end it and also unpipe our source, to avoid calls to _transform in the
      // future
      if (this._bytesToRead === 0) {
        this._source._stream.unpipe(this);
        this.end();
      }

      // If we did not use all the available data, we return it to the source
      // so the next SlicingStream can handle it.
      if (bytesToRead !== bytesAvailable) {
        var unusedChunk = chunk.slice(bytesSkipped + bytesToRead);
        this._source._stream.unshift(unusedChunk);
      }

      callback(null);
    }
  }]);

  return SlicingStream;
}(_stream.Transform);

function getSource(input, chunkSize) {
  if (Buffer.isBuffer(input)) {
    return new BufferSource(input);
  }

  if (input instanceof _fs.ReadStream && input.path != null) {
    return new FileSource(input);
  }

  if (input instanceof _stream.Readable) {
    return new StreamSource(input, chunkSize);
  }

  throw new Error("source object may only be an instance of Buffer or Readable in this environment");
}
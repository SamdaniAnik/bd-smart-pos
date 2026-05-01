let ioInstance = null;

function setSocketInstance(io) {
  ioInstance = io;
}

function getSocketInstance() {
  return ioInstance;
}

module.exports = {
  setSocketInstance,
  getSocketInstance,
};

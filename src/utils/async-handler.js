'use strict';

// 把 async 路由中抛出的异常统一交给 Express 错误中间件
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};

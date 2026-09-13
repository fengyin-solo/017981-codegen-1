/**
 * 日志工具类 - 提供统一的日志记录功能
 */
export class Logger {
  constructor(module) {
    this.module = module;
    this.enabled = true; // 可以通过配置禁用日志
  }

  /**
   * 格式化日志消息
   */
  formatMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${this.module}]`;
    return { prefix, message, data };
  }

  /**
   * 信息日志
   */
  info(message, data = null) {
    if (!this.enabled) return;
    const { prefix } = this.formatMessage('INFO', message, data);
    if (data) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  /**
   * 警告日志
   */
  warn(message, data = null) {
    if (!this.enabled) return;
    const { prefix } = this.formatMessage('WARN', message, data);
    if (data) {
      console.warn(`${prefix} ${message}`, data);
    } else {
      console.warn(`${prefix} ${message}`);
    }
  }

  /**
   * 错误日志
   */
  error(message, error = null) {
    if (!this.enabled) return;
    const { prefix } = this.formatMessage('ERROR', message, error);
    if (error) {
      console.error(`${prefix} ${message}`, error);
    } else {
      console.error(`${prefix} ${message}`);
    }
  }

  /**
   * 调试日志
   */
  debug(message, data = null) {
    if (!this.enabled) return;
    const { prefix } = this.formatMessage('DEBUG', message, data);
    if (data) {
      console.debug(`${prefix} ${message}`, data);
    } else {
      console.debug(`${prefix} ${message}`);
    }
  }

  /**
   * 性能计时开始
   */
  timeStart(label) {
    if (!this.enabled) return;
    console.time(`[${this.module}] ${label}`);
  }

  /**
   * 性能计时结束
   */
  timeEnd(label) {
    if (!this.enabled) return;
    console.timeEnd(`[${this.module}] ${label}`);
  }
}

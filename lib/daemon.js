const vscode = require("vscode");
const oboe = require("oboe");
const { spawn, exec } = require("child_process");
const { EventEmitter } = require("events");

const {
  projectDirectoryPath,
  currentFilePath,
  currentFileContents
} = require("./project");

let daemon = null;

const emitter = new EventEmitter();
const on = emitter.on.bind(emitter);

function getPath() {
  return new Promise((resolve, reject) => {
    try {
      exec("which importjs", (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

function install() {
  return new Promise((resolve, reject) => {
    try {
      const test = /^win/.test(process.platform);
      const npm = spawn(/^win/.test(process.platform) ? "npm.cmd" : "npm",
        ["install", "-g", "import-js"], {
        cwd: projectDirectoryPath()
      });
      npm.on("error", error => reject(error));
      npm.on("close", () => resolve());
    } catch (error) {
      reject(error);
    }
  });
}

function tryInstall() {
  vscode.window.showInformationMessage("Installing ImportJS");

  return install()
    .then(() => {
      vscode.window.showInformationMessage("ImportJS installed!");
    })
    .catch(error => {
      vscode.window.showInformationMessage(
        `Failed to install ImportJS: ${error.message}`
      );
    });
}

function handleError(error) {
  daemon = null;
  console.warn("Failed to start ImportJS server", error);

  getPath()
    .then(() => {
      vscode.window.showWarningMessage(
        `Failed to start ImportJS server: ${error.message}`
      );
    })
    .catch(() => {
      const installMessage = "Install globally via npm";

      vscode.window
        .showWarningMessage(
          `Failed to start ImportJS server: importjs not found in PATH`,
          installMessage
        )
        .then(selected => {
          if (selected === installMessage) {
            tryInstall();
          }
        });
    });
}

function start() {
  try {
    const daemonExecutable = /^win/.test(process.platform) ? "importjs.cmd" : "importjs";
    daemon = spawn(daemonExecutable, ["start", `--parent-pid=${process.pid}`], {
        cwd: projectDirectoryPath()
      });
    daemon.on("error", handleError);
    daemon.on("close", () => daemon = null);
  } catch (error) {
    handleError(error);
    return;
  }

  // Ignore the first message passed. This just gives the log path, and isn't json.
  daemon.stdout.once("data", () => {
    // After the first message, handle top-level JSON objects
    oboe(daemon.stdout).node("!", obj => {
      emitter.emit("message", obj);
    });
  });
}

function run(command, commandArg) {
  if (!daemon) {
    start();
  }

  const payload = {
    command: command,
    commandArg: commandArg,
    pathToFile: currentFilePath(),
    fileContent: currentFileContents()
  };

  daemon.stdin.write(JSON.stringify(payload) + "\n");
}

function isRunning() {
  return !!daemon;
}

function kill() {
  if (daemon) {
    daemon.kill();
    daemon = null;
  }
}

exports.isRunning = isRunning;
exports.start = start;
exports.kill = kill;
exports.run = run;
exports.on = on;

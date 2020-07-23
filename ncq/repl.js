const PromptReadable = require("./ui/prompt-readable");
const PromptWritable = require("./ui/prompt-writable");
const { footer } = require("./ui/footer");
const { getLogger } = require("./logger");
const CodeSearch = require("./service/code-search");

const CliProgress = require("cli-progress");
const cprocess = require("child_process");
const fs = require("fs");
const ProgressMonitor = require("progress-monitor");
const Store = require("data-store");
let Table = require("tty-table");
const colors = require("ansi-colors");
const repl = require("repl");
const path = require("path");


const VERSION = "1.0.0";
const NAME = "NCQ";
var searcher;
var options = {};
var replInstance;
var logger;

/**
 * REPL functions.
 */
const state = {
  /**
   * REPL Function to search for samples by task, then make cyclable.
   * @param {String} task - Task to search by
   */
  samples(task) {
    //get snippets
    var snippets = searcher.snippetsByTask(task);
    if (!snippets || snippets.length < 1) {
      console.log("could not find any samples for this task");
      return;
    }

    //set cyclable
    replInstance.inputStream.setSnippets(snippets);
    return;
  },

  /**
   * Get samples for a package name.
   * @param {String} packageName - Package name to search by
   */
  packageSamples(packageName) {
    var snippets = searcher.snippetsByPackage(packageName);
    if (!snippets || snippets.length < 1) {
      console.error(NAME + ": could not find any samples for this package");
      return;
    }

    //set cycleable
    replInstance.inputStream.setSnippets(snippets);
    return;
  },

  /**
   * Lists top 50 packages for a given task. By default prints from 0.
   */
  packages(task, index = 0) {
    var packages = searcher.packagesByTask(task);

    //format header
    var header = [
      { value: "index", width: 10 },
      { value: "name" },
      { value: "desciption", align: "left" },
    ];

    var subset = packages.slice(index, index + 25);

    var rows = [];
    for (var i = 0; i < subset.length; i++) {
      var p = subset[i];
      var name = p.name;
      var description = p.description;
      rows.push([(i + index).toString(), name, description]);
    }

    //do table using tty-table (will auto scale)
    let tableANSI = Table(header, rows, { headerAlign: "center" }).render();
    console.log(tableANSI);

    //print how many are not displayed
    var rest = packages.length - (subset.length + index);
    if (rest > 0) {
      console.log(
        "...and " +
          rest +
          " more packages. " +
          colors.green(
            'Hint: Use packages("' +
              task +
              '", ' +
              (index + 25) +
              ") to see more."
          )
      );
    }
  },

  /**
   * Install passed package.
   * @param {String} packageString - String list of package names
   * @param {Object} output - Output option for execSync, by default 'inherit'.
   */
  install(packageString, output = "inherit") {
    //get package array
    var packages = packageString.split(" ");
    //cli install
    try {
      cprocess.execSync(
        "npm install " +
          packages.join(" ") +
          " --save --production --no-optional",
        {
          stdio: output,
        }
      );
    } catch (err) {
      //catch error installing
      console.log("Install failed with code " + err.status);
      return;
    }

    //update state
    searcher.state.installedPackageNames = searcher.state.installedPackageNames.concat(
      packages
    );

    //update repl
    replInstance.inputStream.setMessage(
      "[" + searcher.state.installedPackageNames.join(" ") + "]"
    );
  },

  /**
   * Uninstall passed package.
   * @param {String} packageString - String list of package names
   * @param {Object} output - Output option for execSync, by default 'inherit'.
   */
  uninstall(packageString, output = "inherit") {
    //get packages
    var packages = packageString.split(" ");

    //cli uninstall
    try {
      cprocess.execSync(
        "npm uninstall " + packages.join(" ") + " --save --production",
        {
          stdio: output,
        }
      );
    } catch (err) {
      //catch error uninstalling
      console.log("Uninstall failed with code " + err.status);
      return;
    }

    //update installed packages
    for (var packageName of packages) {
      var index = searcher.state.installedPackageNames.indexOf(packageName);
      if (index != -1) searcher.state.installedPackageNames.splice(index);
    }

    replInstance.inputStream.setMessage(
      "[" + searcher.state.installedPackageNames.join(" ").trim() + "]"
    );
  },

  /**
   * Print version.
   */
  version() {
    console.log(`Node Query Library (NQL) version ${VERSION}`);
  },

  /**
   * Print help.
   */
  help() {
    console.log("========================================");
    console.log(
      "samples(String task)                 search for samples using a task"
    );
    console.log(
      "packages(String task, int index?)    search for packages using a task, optional index to navigate results"
    );
    console.log(
      "packageSamples(String package)       search for samples for a package"
    );
    console.log("install(String package)              install given package");
    console.log("uninstall(String package)            uninstall given package");
    console.log("");
  },

  /**
   * Exit REPL.
   */
  exit() {
    process.exit(0);
  },
};

//run if called as main, not if required
if (require.main == module) {
  main();
}

async function main() {
  //init
  initialize();

  //start repl
  replInstance = repl.start(options);

  //assign functions
  Object.assign(replInstance.context, state);

  defineCommands();
}

/**
 * Initialize application.
 */
function initialize() {
  logger = getLogger(true);

  var ticks = 0;

  var monitor = new ProgressMonitor(100);

  var progressBar = new CliProgress.SingleBar({
    format: "LOADING: [{bar}]",
    barCompleteChar: "\u25AE",
    barIncompleteChar: ".",
  });

  monitor.on("start", function () {
    progressBar.start(100, 0);
  });

  var worked = 0;
  monitor.on("work", function (value) {
    worked += value;
    progressBar.update(worked);
  });

  monitor.on("end", function () {
    progressBar.update(100);
    progressBar.stop();
  });

  //setup codesearch service
  searcher = new CodeSearch();
  //searcher.state.data.MAX = 100;
  searcher.initialize(monitor);

  searcher.state.installedPackageNames = getInstalledPackages();

  var tasks = searcher.state.data.getTaskSet();

  initializeREPL(tasks);
}

/**
 * Process args for installed packages.
 */
function getInstalledPackages() {
  var args = process.argv.slice(2);
  var installedPackages = [];

  for (var pk of args) {
    //ignore passed options
    if (!pk.trim().startsWith("--")) {
      installedPackages.push(pk);
    }
  }

  return installedPackages;
}
/**
 * Setup REPL instance and options.
 * @param {Array} tasks - Array of tasks to use for suggestions.
 */
function initializeREPL(tasks) {
  //create input stream
  var pReadable = new PromptReadable({
    choices: tasks.slice(0, 10000).sort(),
    prefix: NAME,
    message: "[" + searcher.state.installedPackageNames.join(" ") + "]",
    footer: footer,
    multiline: true,
    scroll: true,
    history: {
      store: new Store({ path: searcher.state.HISTORY_DIR }),
      autosave: true,
    },
  });

  //create the output object for repl, passing the input object so we can get the prompt
  var pWritable = new PromptWritable(pReadable);

  //set options
  options = {
    prompt: "",
    ignoreUndefined: true,
    input: pReadable,
    output: pWritable,
    breakEvalOnSigint: true,
  };
}

function defineCommands() {
  replInstance.defineCommand("editor", {
    help: "Enter editor mode",
    action: editor,
  });
}

//for now just prints context
function editor() {
  //print instructions
  console.log("// Entering editor mode");

  //get code from repl context
  var code = replInstance.lines.join("\n");

  //open a new process for editing so we can do this sync (we could do a custom command for things like vim too!)

  //save file
  fs.writeFileSync("index.js", code);

  var appPath = path.join(
    searcher.state.BASE_DIR,
    "ncq/ui/default-editor-process.js"
  );
  var filePath = path.join(process.cwd(), "index.js");
  var command = "node " + appPath + " " + filePath;

  //https://stackoverflow.com/questions/25789064/node-js-readline-with-interactive-child-process-spawning
  //not exactly related but a bit of info on setrawmode and why it avoids some weird bugs
  process.stdin.setRawMode(true);

  try{
    cprocess.execSync(command, {
      stdio: 'inherit',
    });
  }
  catch(err){
    console.log(err.status)
  }

  //without this ctrl+c is passed to parent, this really seems to fix a lot of child process issues!
  process.stdin.setRawMode(false);

  console.log("// Loading and running new context, will print");

  //clear context
  this.clearBufferedCommand();
  this.resetContext();
  Object.assign(replInstance.context, state); //bit of a hack to get our commands back, should i move them to the dot style? 
  //call default load
  replInstance.commands["load"].action.call(replInstance, "index.js")
}

exports.state = state;

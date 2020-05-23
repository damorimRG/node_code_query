require("mocha");
var assert = require("assert");
const Cmd = require("../ncq/cmd");
const PromptHandler = require("../ncq/ui/prompt-handler");
const cprocess = require("child_process");
const sinon = require("sinon");
const { Input } = require("enquirer");

async function send(string, prompt) {
  for (let i = 0; i < string.length; i++) {
    await prompt.keypress(string[i]);
  }
  await prompt.submit();
}

describe("Cmd", function () {
  var output = [];

  before(() => {
    // stub console log to push to an array
    sinon.stub(console, "log").callsFake(function (string) {
      output.push(string);
    });
  });

  this.beforeEach(() => {
    output = [];
  });

  describe("functions", function () {
    it("should run help()", async function () {
      var myCmd = new Cmd(new PromptHandler(Input, { show: false }));

      var counter = 0;

      myCmd.input.input = async function () {
        if (counter == 0) {
          await send("help()", myCmd.input.prompt);
        }
        if (counter == 1) {
          await send("exit()", myCmd.input.prompt);
        }
        counter++;
      };

      await myCmd.run();

      assert.strictEqual(output[1], "Documented commands (type help(<topic>)):");
    });
    it("should also accept no brackets for argumentless", async function () {
      var myCmd = new Cmd(new PromptHandler(Input, { show: false }));

      var counter = 0;

      myCmd.input.input = async function () {
        if (counter == 0) {
          await send("help", myCmd.input.prompt);
        }
        if (counter == 1) {
          await send("exit()", myCmd.input.prompt);
        }
        counter++;
      };

      await myCmd.run();

      assert.strictEqual(output[1], "Documented commands (type help(<topic>)):");
    });
    it("should print help for exit", async function () {
      var myCmd = new Cmd(new PromptHandler(Input, { show: false }));

      var counter = 0;

      myCmd.input.input = async function () {
        if (counter == 0) {
          await send("help(\"exit\")", myCmd.input.prompt);
        }
        if (counter == 1) {
          await send("exit()", myCmd.input.prompt);
        }
        counter++;
      };

      await myCmd.run();

      assert.strictEqual(
        output[0],
        "Exits the application. Shorthand: Ctrl-D."
      );
    });
    it("should print help for help", async function () {
      var myCmd = new Cmd(new PromptHandler(Input, { show: false }));

      var counter = 0;

      myCmd.input.input = async function () {
        if (counter == 0) {
          await send("help(\"help\")", myCmd.input.prompt);
        }
        if (counter == 1) {
          await send("exit()", myCmd.input.prompt);
        }
        counter++;
      };

      await myCmd.run();

      assert.strictEqual(
        output[0],
        'List available commands with "help()" or detailed help with "help(<cmd>)".'
      );
    });
    it("should handle unknown syntax", async function () {
      var myCmd = new Cmd(new PromptHandler(Input, { show: false }));

      var counter = 0;

      myCmd.input.input = async function () {
        if (counter == 0) {
          await myCmd.input.prompt.keypress("a");
          await myCmd.input.prompt.keypress("a");
          await myCmd.input.prompt.keypress("a");
          await myCmd.input.prompt.keypress("a");
          await myCmd.input.prompt.keypress("a");
          myCmd.input.prompt.submit();
        }
        if (counter == 1) {
          await send("exit()", myCmd.input.prompt);
        }
        counter++;
      };

      await myCmd.run();

      assert.strictEqual(output[0], "*** Unknown syntax: aaaaa");
    });
    it("should do previous command on enter", async function () {
      var myCmd = new Cmd(
        new PromptHandler(Input, { show: false, history: {} })
      );

      var counter = 0;

      myCmd.input.input = async function () {
        if (counter == 0) {
          await myCmd.input.prompt.keypress("h");
          await myCmd.input.prompt.keypress("e");
          await myCmd.input.prompt.keypress("l");
          await myCmd.input.prompt.keypress("p");
          await myCmd.input.prompt.keypress("(");
          await myCmd.input.prompt.keypress(")");
          myCmd.input.prompt.submit();
        }
        if (counter == 1) {
          myCmd.input.prompt.submit();
        }
        if (counter == 2) {
          await send("exit()", myCmd.input.prompt);
        }
        counter++;
      };

      await myCmd.run();

      assert.strictEqual(output[1], output[6]);
    });
    it("should handle no command", async function () {
      var myCmd = new Cmd(
        new PromptHandler(Input, { show: false, history: {} })
      );

      var counter = 0;

      myCmd.input.input = async function () {
        if (counter == 0) {
          await myCmd.input.prompt.keypress("a");
          await myCmd.input.prompt.keypress("a");
          await myCmd.input.prompt.keypress("(");
          await myCmd.input.prompt.keypress(")");
          myCmd.input.prompt.submit();
        }
        if (counter == 1) {
          myCmd.input.prompt.submit();
        }
        if (counter == 2) {
          await send("exit()", myCmd.input.prompt);
        }
        counter++;
      };

      await myCmd.run();

      assert.strictEqual(output[0], "*** Unknown syntax: aa()");
    });
    it("should handle unkown command", async function () {
      var myCmd = new Cmd(
        new PromptHandler(Input, { show: false, history: {} })
      );

      var counter = 0;

      myCmd.input.input = async function () {
        if (counter == 0) {
          await myCmd.input.prompt.keypress("(");
          await myCmd.input.prompt.keypress(")");
          myCmd.input.prompt.submit();
        }
        if (counter == 1) {
          myCmd.input.prompt.submit();
        }
        if (counter == 2) {
          await send("exit()", myCmd.input.prompt);
        }
        counter++;
      };

      await myCmd.run();

      assert.strictEqual(output[0], "*** Unknown syntax: ()");
    });
    it("should handle unknown help command", async function () {
      var myCmd = new Cmd(
        new PromptHandler(Input, { show: false, history: {} })
      );

      var counter = 0;

      myCmd.input.input = async function () {
        if (counter == 0) {
          await send('help("unknown")', myCmd.input.prompt);
        }
        if (counter == 1) {
          await send("exit()", myCmd.input.prompt);
        }
        counter++;
      };

      await myCmd.run();

      assert.strictEqual(output[0], "*** No help on unknown");
    });
  });
  describe("inheritance", function () {
    it("should support inheritance", function () {
      class Custom extends Cmd {}
      assert(Custom != null);

      var myCMD = new Custom();
      assert(myCMD != null);
    });
    it("should recognize functions when extended", async function () {
      class Custom extends Cmd {
        do_test(inp) {
          console.log("testing");
        }
      }
      var myCmd = new Custom(new PromptHandler(Input, { show: false }));

      var counter = 0;
      myCmd.input.input = async function () {
        if (counter == 0) {
          await myCmd.input.prompt.keypress("t");
          await myCmd.input.prompt.keypress("e");
          await myCmd.input.prompt.keypress("s");
          await myCmd.input.prompt.keypress("t");
          await myCmd.input.prompt.keypress("(");
          await myCmd.input.prompt.keypress(")");
          myCmd.input.prompt.submit();
        }
        if (counter == 1) {
          await send("exit()", myCmd.input.prompt);
        }
        counter++;
      };

      await myCmd.run();

      assert.strictEqual(output[0], "testing");
    });
    it("should print help for new functions in undoc", async function () {
      class Custom extends Cmd {
        do_test(inp) {
          console.log("testing");
        }
      }
      var myCmd = new Custom(new PromptHandler(Input, { show: false }));

      var counter = 0;
      myCmd.input.input = async function () {
        if (counter == 0) {
          await send("help()", myCmd.input.prompt);
        }
        if (counter == 1) {
          await send("exit()", myCmd.input.prompt);
        }
        counter++;
      };

      await myCmd.run();

      assert.strictEqual(output[5], "Undocumented commands:");
      assert.strictEqual(output[7], "test()");
    });
  });

  /**
   * Restore all functions.
   */
  after(() => {
    console.log.restore();
  });
});
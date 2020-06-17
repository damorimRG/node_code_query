const { AutoComplete, Select, Prompt } = require("enquirer");
const { to_width, width_of } = require("to-width");
const ansi = require("enquirer/lib/ansi");
const stripAnsi = require("strip-ansi");
const wrapAnsi = require("wrap-ansi");
const colors = require("ansi-colors");
const { getConfig } = require("../../config");
const { width } = require("enquirer/lib/utils");

/**
 * Extended Enquirer AutoComplete.
 *
 * This is the base class for any major under the hood tweaks, like rendering.
 * The idea is to keep the other two prompt files simple.
 *
 * Changes:
 * - Can enter custom input.
 * - Can toggle autocomplete
 * - Can enter empty
 * - Fix bugs
 * - Can pass no choice array
 * - Can insert at toggle point and multiple times
 * - Enable Multiline
 */
class BasePrompt extends AutoComplete {
  /**
   * Constructor.
   * Sets up AutoComplete options, then our options.
   */
  constructor(options = {}) {
    super(options);

    //keybindings from config
    this.keys = getConfig().get("keybindings");

    //state
    this.isSuggesting = false;
    this.suggestionStart = -1;
    this.filtered = [];
    this.lineBuffer = [];
    this.topLine = 0;

    this.scroll = this.options.scroll;
    this.scrollPos = 0;
  }

  /** Extend dispatch to fix this bug https://github.com/enquirer/enquirer/issues/285.
   *  Dispatch is called by super.keypress(), to add characters to the input.
   */
  async dispatch(s, key) {
    //don't print box on ctrl+c
    if (key.raw === "\u0003") {
      return;
    }
    if (s) {
      super.dispatch(s, key);
    }
  }

  scrollDown(i){
    if(!this.isSuggesting) return;
    return super.scrollDown(i);
  }

  scrollUp(i){
    if(!this.isSuggesting) return;
    return super.scrollUp(i);
  }

  /**
   * Reset that allows empty suggestion list.
   */
  reset() {
    if (this.selectable.length === 0) {
      return;
    }
    return super.reset();
  }

  /**
   * Returns true if check is the same as key.
   */
  isKey(key, check) {
    if (!check) return false;
    var fields = Object.keys(check);
    var is = true;
    for (var i = 0; i < fields.length; i++) {
      if (check[fields[i]] != key[fields[i]]) {
        is = false;
      }
    }

    return is;
  }

  /**
   * Extend keypress to ignore certain keys.
   */
  async keypress(input, key = {}) {
    //autocomplete
    var check = this.keys["autocomplete"];
    if (this.isKey(key, check)) {
      return this.toggle();
    }

    if (!this.isSuggesting) {
      //cursor up and cursor down
      var check = this.keys["cursorUp"];
      if (this.isKey(key, check)) {
        return await this.lineUp();
      }

      var check = this.keys["cursorDown"];
      if (this.isKey(key, check)) {
        return await this.lineDown();
      }
    }

    //line end
    var check = this.keys["lineEnd"];
    if (this.isKey(key, check)) {
      return await this.lineEnd();
    }

    //line start
    var check = this.keys["lineStart"];
    if (this.isKey(key, check)) {
      return await this.lineStart();
    }

    //otherwise,
    return await super.keypress(input, key);
  }

  /**
   * Toggle suggestions.
   */
  async toggle() {
    //if we have no choices, return
    //for some reason this.choices doesnt match this.options right away
    if (!this.options.choices || this.options.choices.length < 1) return;
    //toggle on and record start point
    if (!this.isSuggesting) {
      this.isSuggesting = true;
      this.suggestionStart = this.cursor;
      await this.complete(); //call complete, trigger suggestions
    } else {
      this.isSuggesting = false;
      this.index = -1;
      await this.render();
    }
  }

  /**
   * On Ctrl+left, move to the start of the current line.
   */
  lineStart() {
    if (this.cursor <= 0) return;
    var current = this.cursor;
    var i = current - 1;
    while (i >= 0) {
      var ch = this.input[i];
      if (ch == "\n") {
        break;
      }
      i--;
    }
    this.cursor = i + 1;
    return this.render();
  }

  /**
   * On Ctrl+right, move to line end.
   */
  lineEnd() {
    if (this.cursor >= this.input.length) return;
    var i = this.cursor;
    while (i < this.input.length) {
      var ch = this.input[i];
      if (ch == "\n") {
        break;
      }
      i++;
    }
    this.cursor = i;
    return this.render();
  }

  async lineUp() {
    //do nothing if at 0
    if (this.cursor <= 0) return;

    //get lines
    var lines = this.input.split("\n");

    //on first line, cant go up
    if (this.cursor <= lines[0].length) return;

    //get coords
    var coords = this.getCoords(lines, this.cursor);
    var y = coords[0];
    var x = coords[1];

    //go to end of previous line
    this.cursor -= x + 1;
    //go to pos x
    this.cursor -= Math.max(0, lines[y - 1].length - x);

    await this.render();
  }

  async lineDown() {
    //allow make new line
    if (this.cursor >= this.input.length && this.options.multiline)
      return await this.append("\n");

    //get lines
    var lines = this.input.split("\n");

    //on last line, cant go down
    if (this.cursor >= this.input.length - lines[lines.length - 1].length)
      return;

    //get coords
    var coords = this.getCoords(lines, this.cursor);
    var y = coords[0];
    var x = coords[1];

    //go to start of next line
    this.cursor += lines[y].length - x + 1;
    //go to x or nearest on next line
    this.cursor += Math.min(x, lines[y + 1].length);

    await this.render();
  }

  /**
   * Generates filtered list of choices based on input.
   */
  suggest(input, choices) {
    if (!this.isSuggesting) {
      this.filtered = [];
      return this.filtered;
    }

    //get string to use as a substring from when we pressed tab and what we have written now
    let str = input.toLowerCase().substring(this.suggestionStart, this.cursor);

    //filter
    this.filtered = choices
      .filter((ch) => !ch._userInput)
      .filter((ch) => ch.message.toLowerCase().includes(str));

    //if none, return empty
    if (!this.filtered.length) {
      this.filtered = [];
      return this.filtered;
    }

    return this.filtered;
  }

  /**
   * Custom ighlight function.
   */
  highlight(input, color) {
    let val = input.toLowerCase().substring(this.suggestionStart, this.cursor);
    return (str) => {
      let s = str.toLowerCase();
      let i = s.indexOf(val);
      let colored = color(str.slice(i, i + val.length));
      return i >= 0
        ? str.slice(0, i) + colored + str.slice(i + val.length)
        : str;
    };
  }

  /**
   * Renders the list of choices.
   */
  async renderChoices() {
    //only when suggesting
    if (!this.isSuggesting) {
      this.visible.push("");
      return "";
    }
    //no matching, don't print
    if (!this.visible.length) {
      return "";
    }
    return super.renderChoices();
  }

  /**
   * On cancel, format input to be greyed out.
   * On submit, don't print focused suggestion.
   */
  format() {
    if (this.state.cancelled) return colors.grey(this.value);
    if (this.state.submitted) {
      let value = (this.value = this.input);
      return value;
    }
    return super.format();
  }

  getCoords(lines, cursor) {
    var length = 0;
    var l = lines.length - 1;
    var x = 0;
    for (let i = 0; i < lines.length; i++) {
      var line = stripAnsi(lines[i]) + "\n";
      x = cursor - length;
      length += line.length;
      if (cursor < length) {
        l = i;
        break;
      }
    }
    //x = length - cursor;
    return [l, x];
  }

  scrollBar(lines, visible, top, rows){
    var scrollArray = [];

    //get shown percentage
    var shown = rows / lines.length;
    //apply to number of rows
    var bar = Math.round(rows*shown);
    //make sure bar is at least visible
    if(bar == 0) bar = 1;
    //get rows from top
    var scrollTop = Math.round(top*shown);

    for (let i = 0; i < rows; i++) {
      if(i >= scrollTop && i < (scrollTop + bar)){
        scrollArray.push(colors.inverse(" "));
      }
      else{
        if(i == 0){
          scrollArray.push("▲");
        }
        else if(i == (rows-1)){
          scrollArray.push("▼");
        }
        else{
          scrollArray.push(" ");
        }
      }
    }

    return scrollArray;
  }

  /**
   * Render lines that fit on the terminal.
   */
  renderLines(header, prompt, body, footer) {
    //ignore header and footer for now
    var string = [prompt, body].filter(Boolean).join("\n");

    if (this.state.submitted || this.state.cancelled) {
      return [header, prompt, body, footer].filter(Boolean).join("\n");
    }
    var rows = this.height;
    //leave space for footer
    if (footer) {
      rows = rows - 1;
    }
    var columns = this.width;
    //space for scroll bar
    if(this.scroll){
      columns -= 2;
    }
    var cursor = this.cursor + width_of(this.state.prompt);

    //get lines
    var wrapped = wrapAnsi(string, columns, {
      trim: false,
      hard: true,
    });
    this.lineBuffer = wrapped.split("\n");

    var l = this.getCoords(this.lineBuffer, cursor)[0];

    if (l < this.topLine) {
      this.topLine = Math.max(Math.min(l, this.lineBuffer.length - rows), 0);
    } else if (l > this.topLine + rows - 1) {
      this.topLine = Math.min(l, this.lineBuffer.length - rows);
    } else if (this.lineBuffer.length <= rows) {
      this.topLine = 0;
    }

    this.renderedLines = this.lineBuffer.slice(
      this.topLine,
      this.topLine + rows
    );

    if(this.scroll && this.lineBuffer.length > rows){
      var scrollArray = this.scrollBar(this.lineBuffer, this.renderedLines, this.topLine, rows);
      for(var i=0; i<rows; i++){
        var line = this.renderedLines[i];
        if(line == undefined){
          line = "";
        }
        line = to_width(line, columns, { align: "left" });
        line += " " + scrollArray[i];
        this.renderedLines[i] = line;
      }
    }

    //if we have a footer
    if (footer) {
      //get footer line
      var lastLine = footer;
      if(width_of(footer) > this.width){
        lastLine = wrapAnsi(footer, this.width, {
          trim: false,
          hard: true,
        }).split("\n")[0];
      }

      //add a single space between if available
      if(this.renderedLines.length < rows){
        this.renderedLines.push("");

        //if not suggesting, add space for suggestions so footer doesnt jump around
        if(!this.isSuggesting){
          var space = rows - this.renderedLines.length;
          space = Math.min(this.limit, space);
          for(var i=0; i<space; i++){
            this.renderedLines.push("");
          }
        }
      }

      //add to renderedlines
      this.renderedLines.push(lastLine);
    }

    this.line = l;

    var final = this.renderedLines.join("\n");

    return final;
  }

  /**
   * Overwrite render
   * Use our highlight function
   * Render using lines
   * Move cursor
   * Clear asap, this avoids an extra line staying on cancel (why?)
   */
  async render() {
    let style = this.options.highlight
      ? this.options.highlight.bind(this)
      : this.styles.placeholder;

    let color = this.highlight(this.input, style);
    let choices = this.choices;
    this.choices = choices.map((ch) => ({ ...ch, message: color(ch.message) }));

    let { submitted, size } = this.state;

    await this.clear(size);

    let prompt = "";
    let header = await this.header();
    let prefix = await this.prefix();
    let separator = await this.separator();
    let message = await this.message();

    if (this.options.promptLine !== false) {
      prompt = [prefix, message, separator, ""].join(" ");
      this.state.prompt = prompt;
    }

    let output = await this.format();
    let help = (await this.error()) || (await this.hint());
    let body = await this.renderChoices();
    let footer = await this.footer();

    if (output) prompt += output;
    if (help && !prompt.includes(help)) prompt += " " + help;

    //await new Promise(res => setTimeout(res, 2000));
    //await new Promise(res => setTimeout(res, 1000));
    var final = this.renderLines(header, prompt, body, footer);
    await this.write(final);
    await this.write(this.margin[2]);
    await this.restore();

    this.writeCursor();

    this.choices = choices;
  }

  async clear(lines = 0) {
    let buffer = this.state.buffer;
    this.state.buffer = "";
    if ((!buffer && !lines) || this.options.show === false) return;

    //get the currently rendered cursor line
    var current = this.prevCoords[0];

    //down to end of lines
    this.stdout.write(ansi.cursor.down(lines - current));

    //clear from bottom up
    this.stdout.write(ansi.clear(buffer, this.width));
  }

  /**
   * Overwrite sectioons to not rely on prompt, because the prompt may be hidden.
   * For now this means header must be static, but we don't print header atm.
   */
  sections() {
    let { buffer, input, prompt } = this.state;
    prompt = colors.unstyle(prompt);
    let buf = colors.unstyle(buffer);
    let idx = buf.indexOf(prompt);
    if (idx == -1) {
      idx = buf.indexOf(this.state.header);
      if (idx == -1) {
        idx = 0;
      }
    }
    let header = buf.slice(0, idx);
    let rest = buf.slice(idx);
    let lines = rest.split("\n");
    let first = lines[0];
    let last = lines[lines.length - 1];
    let promptLine = prompt + (input ? " " + input : "");
    let len = promptLine.length;
    let after = len < first.length ? first.slice(len + 1) : "";
    return { header, prompt: first, after, rest: lines.slice(1), last };
  }

  async writeCursor() {
    var coords = this.getCoords(
      this.lineBuffer,
      this.cursor + width_of(this.state.prompt)
    );
    coords[0] = coords[0] - this.topLine;

    this.prevCoords = coords;
    if (
      this.stdout &&
      this.state.show !== false &&
      !this.state.submitted &&
      !this.state.cancelled
    ) {
      this.stdout.write(
        ansi.cursor.down(coords[0]) + ansi.cursor.to(coords[1])
      );
    }
  }

  /**
   * Inserts the selected choice, replacing the search substring.
   */
  insertString(str) {
    //add pre
    var input = this.input.slice(0, this.suggestionStart);
    //add str
    input += str;

    //get cursor length at end of insert
    var cursor = input.length;

    //add remaining after cursor
    input += this.input.slice(this.cursor, this.input.length);

    //set input
    this.input = input;

    //set cursor
    this.cursor = cursor;
  }

  /**
   * What happens on submit
   */
  async submit() {
    //if we are suggesting, insert dont submit
    if (this.isSuggesting) {
      //do we have a focused choice?
      let choice = this.focused;
      if (choice) {
        //insert
        this.insertString(this.selected.value);
        this.isSuggesting = false;
        this.index = -1;
        this.suggestionStart = -1;
        await this.render();
        return;
      }
    }

    //use default from input line
    return Prompt.prototype.submit.call(this);
  }
}

// new BasePrompt({footer: function(){return "aaaa";}, multiline:true, choices: ["a"]}).run();

module.exports = BasePrompt;
const repl = require('repl');
const fs = require('fs');
const path = require('path');
const ss = require('string-similarity-js');
const natural = require('natural');
const en = require("stopwords").english;
const acorn = require("acorn");
const acornwalk = require("acorn-walk");

/* constants */
const version = "1.0.0";
const snippets_dir = "./snippets";
const threshold_sim = 0.25;
const tname = "NQL";
const NUM_KEYWORDS = 20;

/* library description */
const library_desc = {};

/* snippet description */
const snippets = {};

// keywords extracted from package description and snippet description (needs to clean up)
const tfidf = new natural.TfIdf();

// my stop words
const our_stopwords = [ "package", "js", "based", "zero", "providing", "massive", "amounts" ]

/* read description of snippets from snippets dir and update variable
 * library_desc and snippets */
fs.readdir(snippets_dir, (err, files) => {
    files.forEach(file => {
        const filepath = path.join(snippets_dir, file);
        const text = fs.readFileSync(filepath, 'utf8');
        // update dictionaries with library and snippet descriptions
        extension = path.extname(file)
        if (extension == ".desc") {
            name = path.basename(file, ".desc")
            library_desc[name] = text;
            tfidf.addDocument(name);
            tfidf.addDocument(removeStopWords(text));
        } else if (extension != ".ignore") {
            // associate snippets to packages
            name = path.basename(file).split(".")[0];
            set = snippets[name]
            if (set === undefined) {
                set = new Set()
                snippets[name] = set
            }
            set.add(text)
        }
    });
});

/* remove stopwords from text */
function removeStopWords(text) {
    textClean = "" 
    text.split(" ").forEach(s => { if (!en.includes(s.trim())) textClean = textClean+" "+s })
    return textClean;
}

function parseJS(text) {
    set = new Set();
    acornwalk.simple(acorn.parse(text), {
        Identifier(node) {
            set.add(node.name);
        }
    })
    res = ""
    set.forEach(s => {res = res + " " + s})
    return res
}

/* auto-completion function passed to repl.start as option. See:
 * https://nodejs.org/api/readline.html#readline_use_of_the_completer_function */
function completer(line) {
    const completions = "list() package(<str>) samples<str> tasks<str> help()".split(" ")
    // completions
    const hits = completions.filter((c) => c.startsWith(line));
    // Show all completions if none found
    return [hits.length ? hits : completions, line];
}


/* creating REPL */
const myRepl = repl.start({prompt: tname+"> ", ignoreUndefined: true, completer: completer});

/* list_packages */
Object.assign(myRepl.context,{
    list(string) {
        Object.keys(library_desc).forEach(s => process.stdout.write(s+" "))
        console.log();
    }});

Object.assign(myRepl.context,{
    package(string) {
        for ([key, val] of Object.entries(library_desc)) {
            if (ss.stringSimilarity(key, string)>0.8) {
                console.log(`${key}      ${val}`);
            } else {
                try {
                    val.split(" ").forEach(s => {
                        if (ss.stringSimilarity(s.toLowerCase(), string.toLowerCase())>0.8) {
                            console.log(`${key}      ${val}`);
                            throw "break"; /* forEach is unbreakable */
                        }
                    })
                } catch(e) {}
            }
        }
    }});

/* list_snippets */
Object.assign(myRepl.context,{
    samples(string) {
        set = snippets[string.trim()]
        if (set == undefined) {
            console.log("could not find any sample for this package")
        } else {
            set.forEach(s => { console.log(s.trim()); console.log("-----") } );
        }

        
    }
});

/* version */
Object.assign(myRepl.context,{
    version() {
        console.log(`Node Query Library (NQL) version ${version}`);        
    }});


Object.assign(myRepl.context,{
    help() {
        console.log("<tab>                     shows functions")
        console.log(`list()               list packages related to keywords`);
        console.log(`package(<package-name>)   describe a given package`);
        console.log(`samples(<package-name>)   list samples catalogued for that package`);
        console.log(`tasks(<str>)              list tasks related to keywords (may involve multiple packages)`);        
    }});
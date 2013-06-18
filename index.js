var uglify = require('uglify-js'),
    traverse = require('traverse'),
    vm = require('vm');

var parse = function (expr) {
    if (!(typeof expr === 'string' || expr instanceof String)){
        throw new Error('Expression should be a string!');
    }
    
    try {
        var ast = uglify.parse(expr);
    }
    catch (err) {
        if (err.message === undefined
        || err.line === undefined
        || err.col === undefined
        || err.pos === undefined
        ) { throw err }

        
        var e = new SyntaxError(
            err.message
            + '\n  at line ' + err.line + ':' + err.col + ' in expression:\n\n'
            + '  ' + expr.split(/\r?\n/)[err.line]
        );
        
        e.original = err;
        e.line = err.line;
        e.col = err.col;
        e.pos = err.pos;
        throw e;
    }
    return ast;
};

var deparse = function (ast, b) {
    var stream = uglify.OutputStream({ beautify : b });
    ast.print(stream);
    return stream.toString();
};

var burrito = module.exports = function (code, cb) {
    var ast = code instanceof uglify.AST_Node ? code // already an ast
        : parse(code.toString());

    var ast_ = traverse(ast).map(function() {
        wrapNode(this, cb);
    });
    
    return deparse(parse(deparse(ast_)), true);
};

var wrapNode = burrito.wrapNode = function (state, cb) {
    var node = state.node;
    
    if(!(node instanceof uglify.AST_Node) || node instanceof uglify.AST_Toplevel){
        return undefined;
    }

    var self = {
        name: node.TYPE.toLowerCase(),
        node : node,
        start : node.start,
        end : node.end,
        state : state
    };
    
    self.wrap = function (s) {
        var subsrc = deparse(
            traverse(node).map(function (x) {
                if (!this.isRoot) wrapNode(this, cb)
            })
        );
        
        if (self.name === 'binary') {
            var a = deparse(traverse(node.left).map(function (x) {
                if (!this.isRoot) wrapNode(this, cb)
            }));
            var b = deparse(traverse(node.right).map(function (x) {
                if (!this.isRoot) wrapNode(this, cb)
            }));
        }
        
        var src = '';
        
        if (typeof s === 'function') {
            if (self.name === 'binary') {
                src = s(subsrc, a, b);
            }
            else {
                src = s(subsrc);
            }
        }
        else {
            src = s.toString()
                .replace(/%s/g, function () {
                    return subsrc
                })
            ;
            
            if (self.name === 'binary') {
                src = src
                    .replace(/%a/g, function () { return a })
                    .replace(/%b/g, function () { return b })
                ;
            }
        }

        var expr = parse(src);
        state.update(expr, true);
    };
    
    var cache = {};
    
    self.parent = state.isRoot ? null : function () {
        if (!cache.parent) {
            var s = state;
            var x;
            do {
                s = s.parent;
                if (s) x = wrapNode(s);
            } while (s && !x);
            
            cache.parent = x;
        }
        
        return cache.parent;
    };
    
    self.source = function () {
        if (!cache.source) cache.source = deparse(node);
        return cache.source;
    };
    
    self.label = function () {
        return burrito.label(self);
    };
    
    if (cb) cb.call(state, self);
    
    if (self.node.name === 'conditional') {
        self.wrap('[%s][0]');
    }
    
    return self;
}

burrito.microwave = function (code, context, cb) {
    if (!cb) { cb = context; context = {} };
    if (!context) context = {};
    
    var src = burrito(code, cb);
    return vm.runInNewContext(src, context);
};

burrito.generateName = function (len) {
    var name = '';
    var lower = '$'.charCodeAt(0);
    var upper = 'z'.charCodeAt(0);
    
    while (name.length < len) {
        var c = String.fromCharCode(Math.floor(
            Math.random() * (upper - lower + 1) + lower
        ));
        if ((name + c).match(/^[A-Za-z_$][A-Za-z0-9_$]*$/)) name += c;
    }
    
    return name;
};

burrito.parse = parse;
burrito.deparse = deparse;

burrito.label = function (node) {
    var ast_node = node.node;
    if (ast_node instanceof uglify.AST_Call) {
        if (ast_node.expression instanceof uglify.AST_Symbol) {
            return ast_node.expression.name;
        }
        else if (ast_node.expression instanceof uglify.AST_Dot){
            return ast_node.expression.property;
        }
        else if (ast_node instanceof uglify.AST_Dot) {
            return ast_node.property;
        }
        else {
            return null;
        }
    }
    else if (ast_node instanceof uglify.AST_Var) {
        return ast_node.definitions.map(function (def){
            return def.name.name;
        });
    }
    else if (ast_node instanceof uglify.AST_Lambda) {
        return ast_node.name instanceof uglify.AST_Symbol ? ast_node.name.name : ast_node.name;
    }
    else {
        return null;
    }
};

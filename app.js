
/**
 * Module dependencies.
 */

var express = require('express'),
  routes = require('./routes'),
  fhc = require('fh-fhc'),
  util = require('util'),
  fs = require('fs'),
  ejs = require('ejs'),
  RedisStore = require('connect-redis')(express);

var app = module.exports = express.createServer();

// Load FHC
fhc.fhc.load({}, function(err) {
  if (err){
    throw new Error(err);
  }
  // Set cluster - //TODO: Targetting apps.feedhenry throws an error at the moment! odd!  
  /*fhc.target(['https://apps.feedhenry.com'], 
      function(err, data) {
        //success
        if (err){
          throw new Error(err);
        }
      }
    );*/
});


// Configuration

app.configure(function(){
  app.set('views', __dirname + '/public/views');
  app.set('view engine', 'ejs');
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(express.session({ secret: "keyboard cat", store: new RedisStore }));
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
  app.use(express.errorHandler()); 
});

// Get Routes

app.get('/', function(req, res){
  res.render('index', {
    title: 'Home',
  });
});

app.get('/home.:resType?', function(req, res){
  
  var d ={
      tpl: 'index',
      title: 'Home',
   }; 
  doResponse(req, res, d);
});

app.get('/signup.:resType?', function(req, res){
  var d ={
      tpl: 'signup',
      title: 'Signup',
  }; 
  doResponse(req, res, d);
});

app.get('/login.:resType?', function(req, res){
  // Show login page
  
  var d = {
    tpl: 'login',
    title: 'Login',
  };
  doResponse(req, res, d);
});

app.get('/apps.:resType?', function(req, res){
  //Apps listing
  
  
  fhc.apps([], function(err, data){
    if (err){
      doError(req, res, "Couldn't generate apps listing", err);
      return;
    }
    var d = {
        tpl: 'apps',
        apps: data.list, 
        title: 'Apps', 
    };
    doResponse(req, res, d);
  });
});

app.get('/apps/:id/:operation?/:subOp?.:resType?', function(req, res){
  
  
  // Show a specific app operation
  var id = req.params.id,
  operation = req.params.operation,
  subOp = req.params.subOp;
  
  // We have an ID - show an individual app
  fhc.apps([id], function(err, data){
    if (err){
      doError(req, res, "Couldn't find app with id" + id);
      return;
    }
    if (!operation){
      operation = 'appDashboard';
    }
    // show tab relating to this operation
    if (operation==="editor"){
      fhc.files(['list', id], function(err, root){
        if (err){
          doError(req, res, "Error retrieving files list", err);
          return; // TODO: Show error logging out page
        }
        var list = JSON.stringify(root);
        
        if (subOp){
          fhc.files(['read', subOp], function(err, file){
            if (err){
              doError(req, res, "Error loading file " + file, err);
              return; // TODO: Show error logging out page
            }
            var d = {
                title: file.fileName,
                tpl: 'app',
                data: data,
                tab: operation,
                filesTree: list,
                file: file.contents,
                mode: 'js'
             };
            doResponse(req, res, d);
          });
        }else{
          var d = {
              title: 'Editor',
              tpl: 'app',
              data: data,
              tab: operation,
              filesTree: list,
              file: false,
              mode: 'js'
          };
          doResponse(req, res, d);
        }
      });
       
    }else{
      var d = {
          tpl: 'app',
          title: 'Login',
          data: data,
          tab: operation,
      };
      doResponse(req, res, d);
    }
    });
  
});

app.get('/logout', function(req, res){
  //debugger;
  fhc.logout([], function(err, data){
    if (err){
      doError(req, res, "Error logging out", err);
      return; // TODO: Show error logging out page
    }
    delete req.session.user;
    res.redirect('/');
  });
});

// Post routers

app.post('/login', function(req, res){
  // Login API operation
  var body = req.body,
  username = body.username,
  password = body.password;
  req.session.username = username,
  args = [username, password];
  
  fhc.login(args, function(err, data) {
    if (err){
      doError(req, res, "Error logging in as user <strong>" + username + "</strong>. Please verify credentials and try again.", err);
      return;
    }
    // Success! Let's set some session properties.
    req.session.user = {
        username: username,
        timestamp: data.timestamp,
        role: 'dev', //TODO: Have FHC pass this through
        login: data.login
    }
    req.session.domain = (data.domain) ? data.domain : "apps";
    res.redirect('/apps');
  });
});



app.listen(3000);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);


function getTemplateString(d){
  var tpl = d.tpl;
  
  //TODO: Check redis first for template. If it doesn't exist, do this:
  var template = fs.readFileSync('public/views/' + tpl + '.ejs', 'utf8'); // TODO: Make async so we can err handle
  
  
  // This is a bit crazy - EJS deprecated partials with no alternative, so we're implementing it using regex. 
  // No better templating engine exists at the moment, so sticking with EJS. 
  // Look for partials & replace them with content
  
  // 1.) First look for quote-includes like <%- partial("someFile") %>
  var rex = /<%- ?partial\( ?"([a-zA-Z\/.]*)" ?\) ?%>/g;
  var match = rex.exec(template);
  while(match!=null){
    if (match.length>0){
      // Recursively call ourselves with the TPL name we need
      var include = getTemplateString({tpl: match[1]});
      template = template.replace(match[0], include);
    }
    match = rex.exec(template);
  }

  
  // 2.) Then look for nonqute-includes like <%- partial(someVariable) %>
  var rex = /<%- ?partial\(( ?[a-zA-Z\/.]* ?)\) ?%>/g;
  

  var match = rex.exec(template);
  while(match!=null){
    if (match.length>0){
      // Now we're going to lookup the variable name in the data to see what the template should be called
      var variable = d[match[1]]; // TODO: Cater for this failing, d[match[1]] being undefined
      // Recursively call ourselves with the TPL name we need
      var include = getTemplateString({tpl: variable});
      
      template = template.replace(match[0], include);
    }
    match = rex.exec(template); 
  }
  
  // <%- someVar %> isn't valid on the client side - replace with <%= 
  var rex = /<%- ([a-zA-Z])+ %>/g
  var match = rex.exec(template);
  while(match!=null){
    template = template.replace(match[0], "<%= filesTree %>");
    match = rex.exec(template);
  }
  // End crazyness
  
  //TODO: Store final generated template doesn't exist in redis.
  //TODO: Store list of unknown templates, bind this to 1k entries or so
    
  return template;
}

function doResponse(req, res, d){
  var resType = (req.params.resType) ? req.params.resType : 'html';
  
  // setup stuff that goes into every response
  
    d.user = (req.session && req.session.user) ? req.session.user : false;
    d.domain = (req.session && req.session.domain) ? req.session.domain : "apps";
  switch(resType){
    case "jstpl":
      // API request - sending back JSON data with a template
      var template = getTemplateString(d);
      res.send({
        data: d,
        template: template,
      });
      break;
      
    case 'json':
      res.send({
        data: d
      });
      break;
      
    default:
       // HTML page GET request - sending back a rendered page
      res.render(d.tpl, d);
      break;
      
  }
  
}

function doError(req, res, msg){
  var d ={
      tpl: 'error',
      title: 'Oops! An error has occured.',
      error: msg
  }; 
  doResponse(req, res, d);
}
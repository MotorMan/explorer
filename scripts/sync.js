var mongoose = require('mongoose')
  , db = require('../lib/database')
  , Tx = require('../models/tx')  
  , Address = require('../models/address')  
  , Richlist = require('../models/richlist')  
  , Stats = require('../models/stats')  
  , settings = require('../lib/settings')
  , fs = require('fs');

var mode = 'update';
var database = 'index';
var blockNumber = 1; //default block start for check is 1.
var blockEnd = 9; //just a random init number, it's overwritten uppon switch/case anyways.
var updateRL = 1;

// displays usage and exits
function usage() {
  console.log('Usage: node scripts/sync.js [database] [mode] [StartingBlock/Update Richlist] [EndingBlock]');
  console.log('');
  console.log('database: (required)');
  console.log('index [mode] Main index: coin info/stats, transactions & addresses');
  console.log('market       Market data: summaries, orderbooks, trade history & chartdata')
  console.log('');
  console.log('mode: (required for index database only)');
  console.log('update       Updates index from last sync to current block');
  console.log('             Update now has an option to enable or disable Richlist updating');//mm add descritpion
  console.log('             by supplying a 1 to enable, or 0 to disable, after the mode option '); //mm add description
  console.log('check        checks index for (and adds) any missing transactions/addresses');
  console.log('             check now accepts a starting Block and Ending Block.'); //mm add description 1
  console.log('             If no value is provided, it will use default settings.');//mm add description 2
  console.log('reindex      Clears index then resyncs from genesis to current block');
  console.log('');
  console.log('notes:'); 
  console.log('* \'current block\' is the latest created block when script is executed.');
  console.log('* The market database only supports (& defaults to) reindex mode.');
  console.log('* If check mode finds missing data(ignoring new data since last sync),'); 
  console.log('  index_timeout in settings.json is set too low.')
  console.log('');
  process.exit(0);
}

// check options
if (process.argv[2] == 'index') {
  if (process.argv.length <3) {
    usage();
 } else {
    switch(process.argv[3])
    {
    case 'update':
      mode = 'update';
	updateRL=parseInt(process.argv[4]); //check the argument, if 1 enable, if 0 disable
	if (isNaN(updateRL)){updateRL=1;} //if NaN then enable, since that is a no-argument response
      break;
    case 'check':
      mode = 'check';
      blockNumber = parseInt(process.argv[4]); //this gets the 4th argument from the command line, the block start, also converts the number from a string to a number.
      blockEnd = parseInt(process.argv[5]); //this gets the 5th argument from the command line, the end block
      if (isNaN(blockNumber)){ blockNumber = 1; }  //yay this fixes NaN
      if (isNaN(blockEnd)){ blockEnd = 99999999; } //if there is no variable provided, give it a huge number.
      break;
    case 'reindex':
      mode = 'reindex';
      break;
    default:
     usage();
    }
  }
} else if (process.argv[2] == 'market'){
  database = 'market';
} else {
  usage();
}

function create_lock(cb) {
  if ( database == 'index' ) {
    //if the argument #3 is check, we name the file differently for anti-collision.
    if (process.argv[3] == 'check' ) { var fname = './tmp/' + database + '-' + blockNumber + '.pid'; }
    else { var fname = './tmp/' + database + '.pid'; }
    fs.appendFile(fname, process.pid, function (err) {
      if (err) {
        console.log("Error: unable to create %s", fname);
        process.exit(1);
      } else {
        return cb();
      }
    });
  } else {
    return cb();
  }
}

function remove_lock(cb) {
  if ( database == 'index' ) {
    //if the argument #3 is check, we name the file differently for anti-collision.
    if ( process.argv[3] == 'check' ) { var fname = './tmp/' + database + '-' + blockNumber + '.pid'; }
    else { var fname = './tmp/' + database + '.pid'; }
    fs.unlink(fname, function (err){
      if(err) {
        console.log("unable to remove lock: %s", fname);
        process.exit(1);
      } else {
        return cb();
      }
    });
  } else {
    return cb();
  }  
}

function is_locked(cb) {
  if ( database == 'index' ) {
    //if the argument #3 is check, we name the file differently for anti-collision.
    if ( process.argv[3] == 'check' ) { var fname = './tmp/' + database + '-' + blockNumber + '.pid'; }
    else { var fname = './tmp/' + database + '.pid'; }
    fs.exists(fname, function (exists){
      if(exists) {
        return cb(true);
      } else {
        return cb(false);
      }
    });
  } else {
    return cb();
  } 
}

function exit() {
  remove_lock(function(){
    mongoose.disconnect();
    process.exit(0);
  });
}

//pull for fixing lock file on crash. doesn't give us any info on what crashed though. remove to see crash info.
process.on('uncaughtException', exitCrash);
process.on('SIGINT', exitSIGINT);
process.on('SIGTERM', exitSIGINT);

function exitSIGINT() {
 console.log("Received kill signal, Exiting!");
 remove_lock(function(){
    mongoose.disconnect();
    process.exit(0);
  });
}

function exitCrash() {
console.log("Program Crashed, Exiting Now."); //added a print so we can see it's exiting abnormally.
  remove_lock(function(){
    mongoose.disconnect();
    process.exit(0);
  });
}


var dbString = 'mongodb://' + settings.dbsettings.user;
dbString = dbString + ':' + settings.dbsettings.password;
dbString = dbString + '@' + settings.dbsettings.address;
dbString = dbString + ':' + settings.dbsettings.port;
dbString = dbString + '/' + settings.dbsettings.database;

is_locked(function (exists) {
  if (exists) {
    console.log("Script already running..");
    process.exit(0);
  } else {
    create_lock(function (){
      console.log("script launched with pid: " + process.pid);
      mongoose.connect(dbString, function(err) {
        if (err) {
          console.log('Unable to connect to database: %s', dbString);
          console.log('Aborting');
          exit();
        } else if (database == 'index') {
          db.check_stats(settings.coin, function(exists) {
            if (exists == false) {
              console.log('Run \'npm start\' to create database structures before running this script.');
              exit();
            } else {
              db.update_db(settings.coin, function(){
                db.get_stats(settings.coin, function(stats){
                  if (settings.heavy == true) {
                    db.update_heavy(settings.coin, stats.count, 20, function(){
                    
                    });
                  }
                  if (mode == 'reindex') {
                    Tx.remove({}, function(err) { 
                      Address.remove({}, function(err2) { 
                        Richlist.update({coin: settings.coin}, {
                          received: [],
                          balance: [],
                        }, function(err3) { 
                          Stats.update({coin: settings.coin}, { 
                            last: 0,
                          }, function() {
                            console.log('index cleared (reindex)');
                          }); 
                          db.update_tx_db(settings.coin, 1, stats.count, settings.update_timeout, function(){
                            db.update_richlist('received', function(){
                              db.update_richlist('balance', function(){
                                db.get_stats(settings.coin, function(nstats){
                                  console.log('reindex complete (block: %s)', nstats.last);
                                  exit();
                                });
                              });
                            });
                          });
                        });
                      });
                    });              
                  } else if (mode == 'check') {
		    if (blockEnd == 99999999) { blockEnd = stats.count; } //fix the arbitrary number, give a REAL number for the block end!
                    db.update_tx_db(settings.coin, blockNumber, blockEnd, settings.check_timeout, function(){//orig blockNumber was 1. stats.count for real end of blocks.
                      db.get_stats(settings.coin, function(nstats){
                        console.log('Check Complete (Block: %s)', nstats.last);
                        exit();
                      });
                    });
                  } else if (mode == 'update') {
		     if (updateRL == 1) {
                      db.update_tx_db(settings.coin, stats.last, stats.count, settings.update_timeout, function(){console.log('Block Update Done, Updating the Richlist');
                        db.update_richlist('received', function(){console.log('Done Updating The Richlist Received, Now Updating The Richlist Balances');
                         db.update_richlist('balance', function(){console.log('Done Updating The Richlist Balances, Now Updating Stats');
                          db.get_stats(settings.coin, function(nstats){
                            console.log('Update Complete (Block: %s)', nstats.last);
                            exit();
                         });
                        });
                      });
                    });
                  } //end if updateRL=1
		     if (updateRL == 0) {
                      db.update_tx_db(settings.coin, stats.last, stats.count, settings.update_timeout, function(){console.log('Block Update Done');
                        db.get_stats(settings.coin, function(nstats){
                          console.log('Update Complete (Block: %s)', nstats.last);
                           exit();
                      });
                    });
                  }//end if updateRL=0
		}//end mode update
                });
              });
            }
          });
        } else {
          //update markets
          var markets = settings.markets.enabled;
          var complete = 0;
          for (var x = 0; x < markets.length; x++) {
            var market = markets[x];
            db.check_market(market, function(mkt, exists) {
              if (exists) {
                db.update_markets_db(mkt, function(err) {
                  if (!err) {
                    console.log('%s market data updated successfully.', mkt);
                    complete++;
                    if (complete == markets.length) {
                      exit();
                    }
                  } else {
                    console.log('%s: %s', mkt, err);
                    complete++;
                    if (complete == markets.length) {
                      exit();
                    }
                  }
                });
              } else {
                console.log('error: entry for %s does not exists in markets db.', mkt);
                complete++;
                if (complete == markets.length) {
                  exit();
                }
              }
            });
          }
        }
      });
    });
  }
});

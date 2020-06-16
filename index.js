const { printSchema, graphql } = require("graphql");
const { ApolloServer } = require("apollo-server");
const convertSchema = require("./convertSchema");
const createResolvers = require("./createResolvers");
const airtable = require("airtable");
const fs = require('fs');
const fetch = require('node-fetch');
const helmet = require('helmet');

//temp "cache"
const savedMapEmptyStruct = `{"events": [], "markerData": [], "date":""}`;

//changes - cache stuff, parse response, run query
class AirtableGraphQL {

  getCache(mapNum){
    //if doesnt exist, create with empty structure
    if(!(fs.existsSync("./cacheMap"+mapNum+".json"))){
      fs.writeFileSync("./cacheMap"+mapNum+".json", savedMapEmptyStruct, function(err) {
        if (err) {
            console.log(err);
        }
      });
    }

    let savedMapTxt = JSON.parse(fs.readFileSync("./cacheMap"+mapNum+".json"));
    return savedMapTxt;
  }

  //run map query from server
  queryMap(mapNum){
    console.log("querying map data");

    return new Promise((resolve,reject) => {
      fetch("http://localhost:8888/", {
        method:'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body:JSON.stringify({
          "operationName":null,
          "variables":{},
          "query":"{\n  map"+mapNum+"S {\n    id\n    end\n    sort\n    media\n    place\n    start\n    title\n    location\n    description\n    descriptionText\n    descriptionMedia\n    descriptionNotes\n    descriptionCensus\n    descriptionSources\n    __typename\n  }\n}\n"
        })
      })
      .then(data => {
        return resolve(JSON.parse(fs.readFileSync("./cacheMap"+mapNum+".json")));
      });
    })
  }

  constructor(apiKey, config = {}) {  
    this.columns = {};
    airtable.configure({ apiKey });
    const schema = JSON.parse(fs.readFileSync(config.schemaPath || "./schema.json", "utf8"));

    var normalizedPath = require("path").join(__dirname, "columns");
    require("fs")
      .readdirSync(normalizedPath)
      .forEach(file => {
        require("./columns/" + file)(this);
      });

    this.api = airtable.base(schema.id);
    this.schema = convertSchema(schema, this.columns);

    this.resolvers = createResolvers(
      schema,
      this.api,
      this.columns
    );

    this.server = new ApolloServer({
      typeDefs: printSchema(this.schema),
      resolvers: this.resolvers,
      playground: config.playground,
      introspection: true,
      plugins:[
        {
          requestDidStart({ request }) { 
            return {
              willSendResponse({response}){
                //parse/save response here - if here, means there was a query, no cache
                let oldResponse = {"events": [],"markerData": [], "date":""};
                let dataEvents = "";
                let mapNum = "1";
                if(response.data.map1S !== undefined){
                  dataEvents = response.data.map1S;
                }
                else if(response.data.map2S !== undefined){
                  dataEvents = response.data.map2S;
                  mapNum = "2";
                }
                
                for(let i = 0; i < dataEvents.length; i++)
                {
                  //timeline stuff
                  oldResponse.events.push({
                    "media": {
                      "url": "",
                      "caption": "",
                      "credit": ""
                    },
                    "start_date": {
                      "month": "",
                      "day": "",
                      "year": ""
                    },
                    "text": {
                      "headline": "",
                      "text": ""
                    }
                  });
          
                  oldResponse.events[i].media.url = dataEvents[i].media;
                  oldResponse.events[i].text.headline = dataEvents[i].title;
                  oldResponse.events[i].text.text = dataEvents[i].description;
          
                  let str = dataEvents[i].start;
                  let date = str.split("-");
                  oldResponse.events[i].start_date.month = date[1];
                  oldResponse.events[i].start_date.day = date[2];
                  oldResponse.events[i].start_date.year = date[0];       
                  
                  //marker stuff
                  oldResponse.markerData.push({
                    "location" : "",
                    "headline" : "",
                    "sortNum" : "",
                    "title" : "",
                    "start" : ""
                  });

                  oldResponse.markerData[i].location = dataEvents[i].location;
                  oldResponse.markerData[i].headline = dataEvents[i].title;
                  oldResponse.markerData[i].sortNum = dataEvents[i].sort;
                  oldResponse.markerData[i].title = dataEvents[i].title;
                  oldResponse.markerData[i].start = dataEvents[i].start;

                }

                oldResponse.date = new Date();

                let savedMap = JSON.stringify(oldResponse);
                fs.writeFileSync("./cacheMap"+mapNum+".json", savedMap, function(err) {
                  if (err) {
                      console.log(err);
                  }
                });
              },

            }; //end return

          }

        }
      ]

    });
    
  }

  addColumnSupport(columnType, config) {
    this.columns = {
      ...this.columns,
      [columnType]: config
    };
  }

  async listen(options) {
    this.server.listen(options).then(({ url }) => {
      console.log(`🚀  Server ready at ${url}`);
    });
  }
}

module.exports = AirtableGraphQL;

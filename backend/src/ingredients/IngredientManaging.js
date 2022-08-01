const UserManaging = require('../user/UserManaging.js');
const {changeExpiry, usersWithExpiringIngredients, removeIngredient, storeIngredient, getIngredients} = require('./IngredientDBAccess.js');
const axios = require('axios');
const express = require('express')
const {verify} = require('../verify.js')
 
const API_KEY = "d1e4859a4c854f3a9f5f8cdbbf2bf18f";
const SERVER_KEY = "key=AAAAMKdSYCY:APA91bFkZgU98nuuyEQod_nkkfKP4U6r3uA-avUnsJu9oNYTw1T3MRgbaZ-pzeDgRkNKJomwiC9LMrvqYKVnkzOZPz5HJDk4Mm96l2E3epm4_ZFVCXBjQMVk4sXV78-H6qVT9voEKfrM";

var app = express();
app.use(express.json());

// setInterval(function() { // should move this to router.js
// 	sendExpiryNotification(Math.round(Date.now() / 1000).toString());
// }, 300000)

const getNotification = async(req, res) => {
	sendExpiryNotification();
	res.send({"result": "Sent notification"});
}

//expects {userid: xxx}
const requestIngredientsAPI = async (req, res) => {
	verify(req.query["googlesignintoken"]).then(() => {
		getIngredients(req.query["userid"]).then((response) => {
			res.status(response.status).send(response.result);
		}).catch((err) => {
			var status = err.status
			delete err["status"]
			res.status(status).send(err);
		});
	});
}

function requestIngredients(userid, googlesignintoken) {
	return new Promise((resolve, reject) => {
        verify(googlesignintoken).then(() => {
            	getIngredients(userid).then((response) => {
				return resolve({"status": 200, data: response.result})
        	}).catch((err) => {
				return reject({"status": err.status, "data": err})
        	}) 
    	})
	})
}

// expects {userid: xxx, ingredient: xxx}
const deleteIngredient = async (req, res) => {
	verify(req.body.googleSignInToken).then(() => {
		removeIngredient(req.body["userid"], req.body["ingredient"]).then((response) => {
			res.status(response.status).send(response.result);
		}).catch((err) => {
			var status = err.status
			delete err["status"]
			res.status(status).send(err);
		});
	}); 
}

// expects {userid: xxx, ingredient: xxx, expiry: xxx}
const updateExpiryDate = async (req, res) => {
	verify(req.body.googleSignInToken).then(() => {
		changeExpiry(req.body["userid"], req.body["ingredient"], req.body["expiry"]).then((response) => {
			res.status(response.status).send(response.result);
		}).catch((err) => {
			var status = err.status
			delete err["status"]
			res.status(status).send(err);
		});
	});
}

function searchForIngredient(ingredient) {
	return new Promise((resolve, reject) => {
		spoonacularSearch(ingredient).then((data) => {
			return resolve(data.results);
		});
	})	
}

// expects {string: xxx}
const getIngredientSuggestions = async (req, res) => {
	verify(req.query["googlesignintoken"]).then(() => {
		spoonacularSuggest(req.query["string"]).then((data) => {
			res.send(data.results);
		}).catch((err) => {
			var status = err.status;
			delete err["status"];
			res.status(status).send(err);
		});
	});
}

// expects {ingredient: xxx}
const requestExpiryDate = async (req, res) => {
	verify(req.query["googlesignintoken"]).then(() => {
		shelfLifeSearch(req.query["ingredient"]).then((data) => {
			if (data.length === 0 || data.code === 500) {
				res.send("-1");
				return;
			}
			let minLevDistance = Number.MAX_VALUE;
			let desiredIngredient;
			data.forEach((ingredient) => {
				let generalName = ingredient.name;
				let levDistance = levenshtein_distance(generalName, req.query["ingredient"]);
				if (levDistance < minLevDistance) {
					minLevDistance = levDistance;
					desiredIngredient = ingredient;
				}
			});
			shelfLifeGuide(desiredIngredient.id).then((expiryData) => {
				let wantedMethod = null;
				expiryData.methods.forEach((method) => {
					if (method.location == "Refrigerator") wantedMethod = method;
					else if (method.location == "Pantry" && wantedMethod == null) wantedMethod = method;
					else wantedMethod = method;
				});
				res.send((wantedMethod.expirationTime + Math.round(Date.now() / 1000)).toString());
			});
		});
	});
}

// expects {userid: xxx, ingredient: xxx, expiry: xxx}
const addIngredient = async (req, res) => {
	verify(req.body.googleSignInToken).then(() => {
		searchForIngredient(req.body.ingredient).then((spoonacularIng) => {
			if (spoonacularIng.length === 0) {
				res.status(410).send(new Error("Error: no ingredient found in Spoonacular API"));
				return;
			}
			var ingredientObj = {
				userid: req.body.userid,
				ingredient: {
					name: req.body.ingredient,
					expiry: req.body.expiry,
					image: spoonacularIng[0].image,
				}
			};
			storeIngredient(ingredientObj.userid, ingredientObj.ingredient).then((response) => {
				res.status(response.status).send(response.result);
			}).catch((err) => {
				var status = err.status
				delete err["status"]
				res.status(status).send(err);
			});
		});
	});
}

function scanExpiryDates(time) {
	return new Promise((resolve, reject) => {
		usersWithExpiringIngredients(time).then(response => {
			return resolve(response.result)
		}).catch(err => {
			return reject(err);
		})
	})
	
}

function expiringIngredients(userid, time) {
	return new Promise((resolve, reject) => {
		if (time < 0) return reject({"status": 405, "result": "Error: invalid expiry value"});
		getIngredients(userid).then((response) => {
			let data = response.result;
			let expiringSoon = [];
			data.forEach((ingredient) => {
				let ingDate = new Date(0);
				let currDate = new Date(0);
				ingDate.setUTCSeconds(ingredient.expiry - (86400 * 2)); // 86400 = 1 day in seconds
				currDate.setUTCSeconds(parseInt(time, 10));
				if (ingDate <= currDate) {
					expiringSoon.push(ingredient);
				}
			});
			return resolve({"status": response.status, "result": expiringSoon});
		}).catch((err) => {
			return reject(err);
		});
	})
}

function levenshtein_distance(inputString, realString) {
	let prevRow = [];
	let currRow = [];
	for (let x = 0; x < realString.length + 1; x++) {
		prevRow[x] = x;
	}
	for (let i = 0; i < inputString.length; i++) {
		currRow[0] = i + 1;
		for (let j = 0; j < realString.length; j++) {
			let deletionCost = prevRow[j + 1] + 1;
			let insertionCost = currRow[j] + 1;
			let substitutionCost = inputString[i] == realString[j] ? prevRow[j] : prevRow[j] + 1;
			currRow[j + 1] = Math.min(deletionCost, insertionCost, substitutionCost);
		}
		prevRow = currRow;
		currRow = [];
	}
	return prevRow[realString.length];
}

// checks expiry dates and sends a notification to the user, if something is expiring
async function sendExpiryNotification(currTime) {
	const data = await scanExpiryDates(currTime);
	let userids = "";
	for (let i = 0; i < data.length; i++) {
		userids += data[i].toString();
		userids += ",";
	}
	userids = userids.slice(0,-1);
	console.log(userids);
	const tokensData = await UserManaging.getUserTokens(userids);
	const tokens = tokensData.result;
	data.forEach((user) => {
		expiringIngredients(user.toString(), currTime).then((response) => response.result).then((ingredient) => {
			var currToken = tokens.find((pair) => pair.userID == user).token
			var expiring = ""
			for (let i = 0; i < ingredient.length; i++) {
				expiring = expiring + ingredient[i]["name"] + ","
			}
			expiring = expiring.slice(0,-1)
			var json = {
				"data": {
					"ingredients": expiring
				},
				"to": currToken.toString()
			}
			sendNotificationFirebase(json).then((result) => {});
		});
	});
	return data;
}

async function sendNotificationFirebase(json) {
	const res = await axios.post("https://fcm.googleapis.com/fcm/send", JSON.stringify(json), {
		"Content-Type": "application/json",
		Authorization: SERVER_KEY
	});
	return res;
}

async function spoonacularSearch(ingredient) {
	const res = await axios.get("https://api.spoonacular.com/food/ingredients/search?query=" +
		ingredient + "&number=1&apiKey=" + API_KEY);
	return res.data;
}

async function spoonacularSuggest(string) {
	const res = await axios.get("https://api.spoonacular.com/food/ingredients/search?query=" +
		string + "&apiKey=" + API_KEY);
	return res.data;
}

async function shelfLifeSearch(ingredient) {
	const res = await axios.get("https://shelf-life-api.herokuapp.com/search?q=" + ingredient);
	return res.data;
}

async function shelfLifeGuide(id) {
	const res = await axios.get("https://shelf-life-api.herokuapp.com/guides/" + id);
	return res.data;
}

module.exports = {getNotification, requestIngredientsAPI, requestIngredients, searchForIngredient, scanExpiryDates, sendExpiryNotification,
	expiringIngredients, deleteIngredient, updateExpiryDate, getIngredientSuggestions, requestExpiryDate, addIngredient, sendNotificationFirebase};
